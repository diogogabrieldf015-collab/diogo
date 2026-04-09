import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import PixQRCode from "react-qr-code";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { generateFakeCustomer } from "@/lib/fake-customer";
import { metaPixelInitiateCheckout, metaPixelPurchase } from "@/lib/meta-pixel";
import { Check, Copy, Eye, Heart, Loader2, QrCode, X } from "lucide-react";

type UpsellKind = "likes" | "views";

const LIKES_PRICE_TABLE: { qty: number; cents: number }[] = [
  { qty: 50, cents: 500 },
  { qty: 100, cents: 800 },
  { qty: 200, cents: 1500 },
  { qty: 300, cents: 2000 },
  { qty: 500, cents: 2800 },
  { qty: 700, cents: 3600 },
  { qty: 1000, cents: 4500 },
  { qty: 1500, cents: 6500 },
  { qty: 2000, cents: 8000 },
  { qty: 3000, cents: 11000 },
  { qty: 5000, cents: 17000 },
  { qty: 7000, cents: 23000 },
  { qty: 10000, cents: 30000 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function formatBRLFromCents(cents: number): string {
  return `R$ ${(Math.max(0, cents) / 100).toFixed(2).replace(".", ",")}`;
}

function normalizePostUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return s;
  }
}

function isValidInstagramLink(kind: UpsellKind, url: string): { ok: boolean; hint?: string } {
  const s = normalizePostUrl(url);
  if (!s) return { ok: false };
  const lower = s.toLowerCase();
  if (!lower.includes("instagram.com/")) {
    return { ok: false, hint: "Cole um link do Instagram (instagram.com)." };
  }
  if (kind === "likes") {
    if (/instagram\.com\/p\//i.test(lower)) return { ok: true };
    if (/instagram\.com\/reel\//i.test(lower)) return { ok: true };
    return { ok: false, hint: "Use link do POST ou do REELS (ex.: https://www.instagram.com/p/... ou /reel/...)." };
  }
  if (/instagram\.com\/reel\//i.test(lower)) return { ok: true };
  return { ok: false, hint: "Use o link do REELS (ex.: https://www.instagram.com/reel/...)." };
}

function computeLikesCentsAnyQty(qtyRaw: number): number {
  const qty = clamp(Math.round(qtyRaw), 50, 10_000);
  const tbl = LIKES_PRICE_TABLE;
  if (qty <= tbl[0].qty) return tbl[0].cents;
  if (qty >= tbl[tbl.length - 1].qty) return tbl[tbl.length - 1].cents;
  const exact = tbl.find((r) => r.qty === qty);
  if (exact) return exact.cents;
  let hiIdx = tbl.findIndex((r) => r.qty > qty);
  if (hiIdx < 1) hiIdx = 1;
  const lo = tbl[hiIdx - 1];
  const hi = tbl[hiIdx];
  const t = (qty - lo.qty) / (hi.qty - lo.qty);
  return Math.max(0, Math.round(lo.cents + (hi.cents - lo.cents) * t));
}

export default function EngajamentoPage() {
  const [kind, setKind] = useState<UpsellKind>("likes");
  const [postUrl, setPostUrl] = useState("");
  const [likesQtyInput, setLikesQtyInput] = useState("");
  const [viewsQtyInput, setViewsQtyInput] = useState("");
  // Views usa a mesma tabela de preço das curtidas (não depende de pacotes no Supabase).

  const [step, setStep] = useState<"form" | "pix" | "success" | "error">("form");
  const [status, setStatus] = useState<"generating" | "ready" | "confirmed" | "error">("generating");
  const [pixCode, setPixCode] = useState("");
  const [pixQrBase64, setPixQrBase64] = useState("");
  const [pixErrorMessage, setPixErrorMessage] = useState("");
  const [orderId, setOrderId] = useState("");
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const purchaseTrackedOrderIdsRef = useRef(new Set<string>());

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const qty = useMemo(() => {
    const raw = kind === "likes" ? likesQtyInput : viewsQtyInput;
    const n = parseInt(raw.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : NaN;
  }, [kind, likesQtyInput, viewsQtyInput]);

  const qtyClamped = useMemo(() => (Number.isFinite(qty) ? clamp(qty, 50, 10_000) : NaN), [qty]);

  const amountCents = useMemo(() => {
    if (!Number.isFinite(qtyClamped)) return NaN;
    return computeLikesCentsAnyQty(qtyClamped);
  }, [qtyClamped]);

  const linkCheck = useMemo(() => isValidInstagramLink(kind, postUrl), [kind, postUrl]);

  const implicitUsername = "instagram";

  const startPolling = useCallback((oid: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-payment", {
          body: { order_id: oid },
        });
        if (error) return;
        const s = data?.status?.toLowerCase();
        if (["paid", "processing", "completed", "placing_smm", "smm_error"].includes(s)) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setStatus("confirmed");
          setStep("success");
        }
      } catch {
        /* ignore */
      }
    }, 5000);
  }, []);

  const extractCreatePaymentError = useCallback(async (pdata: any, fnError: unknown): Promise<string> => {
    if (pdata?.success === false && typeof pdata.error === "string" && pdata.error) return pdata.error;
    if (fnError instanceof FunctionsHttpError) {
      try {
        const text = await (fnError.context as Response).clone().text();
        const j = JSON.parse(text) as { error?: string; message?: string };
        if (typeof j.error === "string") return j.error;
        if (typeof j.message === "string") return j.message;
      } catch {
        /* ignore */
      }
    }
    if (fnError instanceof Error) return fnError.message;
    return "Não foi possível gerar o PIX. Tente de novo.";
  }, []);

  const createPix = useCallback(async () => {
    const user = implicitUsername;
    if (!Number.isFinite(qtyClamped) || qtyClamped < 50 || qtyClamped > 10_000) {
      toast.error("Digite uma quantidade (50 a 10.000)");
      return;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      toast.error("Não foi possível calcular o valor. Tente novamente.");
      return;
    }
    const normalized = normalizePostUrl(postUrl);
    const chk = isValidInstagramLink(kind, normalized);
    if (!chk.ok) {
      toast.error(chk.hint || "Cole um link válido do Instagram.");
      return;
    }

    setStep("pix");
    setStatus("generating");
    setPixErrorMessage("");
    setPixCode("");
    setPixQrBase64("");
    setOrderId("");
    setCopied(false);

    const customer = generateFakeCustomer();
    const body = {
      username: user,
      quantity: qtyClamped,
      amount: amountCents,
      is_discounted: false,
      product_type: kind,
      post_url: normalized,
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        document: customer.document.replace(/\D/g, ""),
      },
    };

    try {
      const { data: paymentData, error: fnError } = await supabase.functions.invoke("create-payment", { body });
      const pdata = paymentData as any;
      if (pdata?.success === false) {
        const msg = pdata.error || "Erro ao gerar PIX";
        setPixErrorMessage(msg);
        setStatus("error");
        setStep("error");
        toast.error(msg);
        return;
      }
      if (fnError) {
        const msg = await extractCreatePaymentError(pdata, fnError);
        setPixErrorMessage(msg);
        setStatus("error");
        setStep("error");
        toast.error(msg);
        return;
      }
      if (pdata?.pix?.qr_code || pdata?.pix?.qr_code_base64) {
        setPixCode(pdata.pix.qr_code || "");
        setPixQrBase64(pdata.pix.qr_code_base64 || "");
        setOrderId(pdata.order_id || "");
        setStatus("ready");
        if (pdata.order_id) {
          startPolling(pdata.order_id);
          metaPixelInitiateCheckout(amountCents / 100, kind === "views" ? "visualizacoes_instagram" : "curtidas_instagram");
        }
      } else {
        const msg = pdata?.error || "Resposta do servidor sem código PIX.";
        setPixErrorMessage(msg);
        setStatus("error");
        setStep("error");
        toast.error(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao gerar pagamento.";
      setPixErrorMessage(msg);
      setStatus("error");
      setStep("error");
      toast.error(msg);
    }
  }, [implicitUsername, qtyClamped, amountCents, postUrl, kind, extractCreatePaymentError, startPolling]);

  useEffect(() => {
    if (status !== "confirmed" || !orderId) return;
    if (purchaseTrackedOrderIdsRef.current.has(orderId)) return;
    purchaseTrackedOrderIdsRef.current.add(orderId);
    metaPixelPurchase(amountCents / 100, kind === "views" ? "visualizacoes_instagram" : "curtidas_instagram");
  }, [status, orderId, amountCents, kind]);

  const copyPixCode = useCallback(() => {
    if (!pixCode) return;
    navigator.clipboard.writeText(pixCode);
    setCopied(true);
    toast.success("Código Pix copiado!");
    setTimeout(() => setCopied(false), 2500);
  }, [pixCode]);

  const resetForNew = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setStep("form");
    setStatus("generating");
    setPixCode("");
    setPixQrBase64("");
    setPixErrorMessage("");
    setOrderId("");
    setCopied(false);
    setPostUrl("");
    setLikesQtyInput("");
    setViewsQtyInput("");
  }, []);

  const title = kind === "views" ? "Comprar visualizações" : "Comprar curtidas";
  const subtitle = kind === "views" ? "Cole o link do Reels" : "Cole o link do post";
  const placeholder = kind === "views" ? "https://www.instagram.com/reel/..." : "https://www.instagram.com/p/...";

  return (
    <div className="min-h-[100dvh] bg-background text-foreground px-4 py-8">
      <div className="mx-auto w-full max-w-xl space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-black tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {subtitle}. Depois que pagar, você pode comprar novamente para outra postagem.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setKind("likes")}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              kind === "likes"
                ? "border-primary/40 bg-primary/10"
                : "border-border bg-card/40 hover:bg-card/60",
            )}
          >
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold">Curtidas</p>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Link do post (instagram.com/p/)</p>
          </button>

          <button
            type="button"
            onClick={() => setKind("views")}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              kind === "views"
                ? "border-secondary/45 bg-secondary/10"
                : "border-border bg-card/40 hover:bg-card/60",
            )}
          >
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-secondary" />
              <p className="text-sm font-bold">Visualizações</p>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Link do Reels (instagram.com/reel/)</p>
          </button>
        </div>

        {step === "form" && (
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{kind === "views" ? "Link do Reels" : "Link do post"}</Label>
              <Input
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder={placeholder}
                className="bg-background/60 border-border"
                autoComplete="off"
              />
              {!linkCheck.ok && postUrl.trim() && (
                <p className="text-[11px] text-destructive">{linkCheck.hint}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Quantidade (50 a 10.000)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={kind === "likes" ? likesQtyInput : viewsQtyInput}
                  onChange={(e) => (kind === "likes" ? setLikesQtyInput(e.target.value) : setViewsQtyInput(e.target.value))}
                  placeholder="Ex.: 500"
                  inputMode="numeric"
                  className="bg-background/60 border-border"
                />
                <div className="shrink-0 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs font-semibold tabular-nums">
                  {Number.isFinite(amountCents) ? formatBRLFromCents(amountCents) : "—"}
                </div>
              </div>

              <input
                type="range"
                min={50}
                max={10_000}
                step={kind === "likes" ? 50 : 100}
                value={Number.isFinite(qtyClamped) ? qtyClamped : 50}
                onChange={(e) => {
                  const v = String(e.target.value);
                  if (kind === "likes") setLikesQtyInput(v);
                  else setViewsQtyInput(v);
                }}
                className="w-full range-thumb-airplane"
              />
            </div>

            <Button
              onClick={() => void createPix()}
              className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-xl"
              disabled={!linkCheck.ok || !Number.isFinite(qtyClamped)}
            >
              <QrCode className="mr-2 h-5 w-5" />
              Gerar PIX
            </Button>
          </div>
        )}

        {step === "pix" && (
          <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3 border-b border-border">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">
                  {kind === "views" ? "PIX · Visualizações" : "PIX · Curtidas"} ({Number.isFinite(qtyClamped) ? qtyClamped : "—"})
                </p>
                <p className="text-xs text-muted-foreground truncate">@{implicitUsername}</p>
              </div>
              <Button variant="outline" onClick={resetForNew} className="h-8 px-3 text-xs">
                Voltar
              </Button>
            </div>

            {status === "generating" && (
              <div className="py-14 flex flex-col items-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Gerando PIX...</p>
              </div>
            )}

            {status === "ready" && (
              <div className="p-4 space-y-3">
                {(pixQrBase64 || pixCode) && (
                  <div className="flex justify-center">
                    <div className="bg-white p-3 rounded-xl inline-block">
                      {pixCode.trim() ? (
                        <PixQRCode value={pixCode} size={192} level="M" bgColor="#ffffff" fgColor="#000000" />
                      ) : pixQrBase64 ? (
                        <img src={`data:image/png;base64,${pixQrBase64}`} alt="QR Code Pix" className="w-48 h-48 object-contain" />
                      ) : null}
                    </div>
                  </div>
                )}

                <textarea
                  readOnly
                  value={pixCode}
                  className="w-full h-20 bg-muted border border-border rounded-lg p-3 text-xs text-foreground resize-none text-center focus:outline-none"
                />

                <Button onClick={copyPixCode} className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-xl">
                  {copied ? <Check className="mr-2 h-5 w-5" /> : <Copy className="mr-2 h-5 w-5" />}
                  {copied ? "Código copiado!" : "Copiar código PIX"}
                </Button>

                <div className="flex items-center justify-center gap-2 pt-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Aguardando pagamento...</p>
                </div>
              </div>
            )}
          </div>
        )}

        {step === "success" && (
          <div className="rounded-2xl border border-border bg-card/60 p-6 text-center space-y-3">
            <div
              className={cn(
                "mx-auto w-16 h-16 rounded-full flex items-center justify-center",
                kind === "views" ? "bg-secondary/20" : "bg-primary/20",
              )}
            >
              {kind === "views" ? (
                <Eye className="h-8 w-8 text-secondary" />
              ) : (
                <Heart className="h-8 w-8 text-primary" />
              )}
            </div>
            <h2 className="text-xl font-black">Pagamento confirmado!</h2>
            <p className="text-sm text-muted-foreground">
              Enviado. Continue comprando para outras postagens.
            </p>
            <Button onClick={resetForNew} className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-xl">
              Comprar para outra postagem
            </Button>
          </div>
        )}

        {step === "error" && (
          <div className="rounded-2xl border border-border bg-card/60 p-6 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/20 flex items-center justify-center">
              <X className="h-7 w-7 text-destructive" />
            </div>
            <h2 className="text-lg font-black">Erro ao gerar PIX</h2>
            {pixErrorMessage && <p className="text-xs text-destructive/90 break-words">{pixErrorMessage}</p>}
            <Button variant="outline" onClick={resetForNew} className="w-full">
              Tentar de novo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

