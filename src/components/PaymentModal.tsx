import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import PixQRCode from "react-qr-code";
import { generateFakeCustomer } from "@/lib/fake-customer";
import { Eye, Loader2, Copy, Check, X, CheckCircle, PartyPopper, QrCode, Heart } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { metaPixelInitiateCheckout, metaPixelPurchase } from "@/lib/meta-pixel";
import { describeEdgeFunctionInvokeError } from "@/lib/edge-function-invoke-error";

interface LikePackageRow {
  id: string;
  quantity: number;
  price: number;
  discount_price: number | null;
}

type UpsellKind = "likes" | "views";
type LikesPricingMode = "grid" | "input";

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

function formatBRLFromCents(cents: number): string {
  return `R$ ${(Math.max(0, cents) / 100).toFixed(2).replace(".", ",")}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function computeLikesCentsAnyQty(qtyRaw: number): number {
  const qty = clamp(Math.round(qtyRaw), 50, 10_000);
  const tbl = LIKES_PRICE_TABLE;
  // Garantia: tabela ordenada crescente
  if (qty <= tbl[0].qty) return tbl[0].cents;
  if (qty >= tbl[tbl.length - 1].qty) return tbl[tbl.length - 1].cents;

  // Match exato
  const exact = tbl.find((r) => r.qty === qty);
  if (exact) return exact.cents;

  // Interpolação linear entre os dois pontos mais próximos
  let hiIdx = tbl.findIndex((r) => r.qty > qty);
  if (hiIdx < 1) hiIdx = 1;
  const lo = tbl[hiIdx - 1];
  const hi = tbl[hiIdx];
  const t = (qty - lo.qty) / (hi.qty - lo.qty);
  const cents = lo.cents + (hi.cents - lo.cents) * t;
  return Math.max(0, Math.round(cents));
}

interface PaymentModalProps {
  open: boolean;
  username: string;
  quantity: number;
  amount: number;
  isDiscounted: boolean;
  profilePic?: string;
  /** Contagem vinda da API de perfil (aproximada). */
  profileFollowers?: number;
}

function normalizePostUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  // Remove parâmetros (utm etc.) para reduzir erro de validação
  try {
    const u = new URL(s);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    // se não for URL válida, devolve como está
  }
  return s;
}

function isValidInstagramLink(kind: "likes" | "views", url: string): { ok: boolean; hint?: string } {
  const s = normalizePostUrl(url);
  if (!s) return { ok: false };
  const lower = s.toLowerCase();
  if (!lower.includes("instagram.com/")) {
    return { ok: false, hint: "Cole um link do Instagram (instagram.com)." };
  }
  // Curtidas: aceitar post (/p/) OU reels (/reel/)
  if (kind === "likes") {
    if (/instagram\.com\/p\//i.test(lower)) return { ok: true };
    if (/instagram\.com\/reel\//i.test(lower)) return { ok: true };
    return { ok: false, hint: "Use link do POST ou do REELS (ex.: https://www.instagram.com/p/... ou /reel/...)." };
  }
  // Visualizações: exigir reel (/reel/)
  if (/instagram\.com\/reel\//i.test(lower)) return { ok: true };
  return { ok: false, hint: "Use o link do REELS (ex.: https://www.instagram.com/reel/...)." };
}

export function PaymentModal({
  open,
  username,
  quantity,
  amount,
  isDiscounted,
  profilePic,
  profileFollowers,
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<"choosing" | "pix">("choosing");
  const [status, setStatus] = useState<"generating" | "ready" | "confirmed" | "error">("generating");
  const [pixCode, setPixCode] = useState("");
  const [pixQrBase64, setPixQrBase64] = useState("");
  const [pixGateway, setPixGateway] = useState<string | null>(null);
  const [pixErrorMessage, setPixErrorMessage] = useState<string>("");
  const [orderId, setOrderId] = useState("");
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const purchaseTrackedOrderIdsRef = useRef(new Set<string>());

  const followersParentOrderIdRef = useRef<string | null>(null);
  const [inUpsellCheckout, setInUpsellCheckout] = useState(false);
  const [upsellFinished, setUpsellFinished] = useState(false);
  const [upsellCheckoutKind, setUpsellCheckoutKind] = useState<UpsellKind>("likes");
  const [upsellDismissed, setUpsellDismissed] = useState(false);
  const [upsellPkgs, setUpsellPkgs] = useState<LikePackageRow[]>([]);
  const [upsellViewsPkgs, setUpsellViewsPkgs] = useState<LikePackageRow[]>([]);
  const [upsellPkgsLoading, setUpsellPkgsLoading] = useState(false);
  const [upsellFetchDone, setUpsellFetchDone] = useState(false);
  const [selectedLikePkgId, setSelectedLikePkgId] = useState<string | null>(null);
  const [selectedViewsPkgId, setSelectedViewsPkgId] = useState<string | null>(null);
  const [upsellKind, setUpsellKind] = useState<UpsellKind>("likes");
  const [likesPricingMode, setLikesPricingMode] = useState<LikesPricingMode>("grid");
  const [likesQtyInput, setLikesQtyInput] = useState("");
  const [viewsQtyInput, setViewsQtyInput] = useState("");
  const [postUrl, setPostUrl] = useState("");

  const [upsellQty, setUpsellQty] = useState(0);
  const [upsellAmount, setUpsellAmount] = useState(0);
  const [upsellDiscounted, setUpsellDiscounted] = useState(false);
  const [showLikesTutorial, setShowLikesTutorial] = useState(false);
  const [showViewsTutorial, setShowViewsTutorial] = useState(false);

  const resetModal = useCallback(() => {
    purchaseTrackedOrderIdsRef.current.clear();
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setPaymentMethod("choosing");
    setStatus("generating");
    setPixCode("");
    setPixQrBase64("");
    setPixGateway(null);
    setPixErrorMessage("");
    setOrderId("");
    setCopied(false);
    followersParentOrderIdRef.current = null;
    setInUpsellCheckout(false);
    setUpsellFinished(false);
    setUpsellCheckoutKind("likes");
    setUpsellDismissed(false);
    setUpsellPkgs([]);
    setUpsellViewsPkgs([]);
    setUpsellPkgsLoading(false);
    setUpsellFetchDone(false);
    setSelectedLikePkgId(null);
    setSelectedViewsPkgId(null);
    setUpsellKind("likes");
    setLikesPricingMode("grid");
    setLikesQtyInput("");
    setViewsQtyInput("");
    setPostUrl("");
    setUpsellQty(0);
    setUpsellAmount(0);
    setUpsellDiscounted(false);
    setShowLikesTutorial(false);
    setShowViewsTutorial(false);
  }, []);

  useEffect(() => {
    if (!open) resetModal();
  }, [open, resetModal]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "confirmed" || !orderId) return;
    if (purchaseTrackedOrderIdsRef.current.has(orderId)) return;
    purchaseTrackedOrderIdsRef.current.add(orderId);
    const cents = upsellFinished ? upsellAmount : amount;
    const upsellEvent =
      upsellCheckoutKind === "views" ? "visualizacoes_instagram" : "curtidas_instagram";
    metaPixelPurchase(
      cents / 100,
      upsellFinished ? upsellEvent : "seguidores_instagram",
    );
  }, [status, orderId, upsellFinished, upsellAmount, amount, upsellCheckoutKind]);

  useEffect(() => {
    if (!upsellFinished) return;
    // Popup rápido pós-compra para incentivar próxima postagem
    toast.success("Enviado! Continue comprando para outras postagens.", { duration: 2200 });
    // volta pro upsell para nova compra (limpa link e quantidade)
    const t = setTimeout(() => {
      setInUpsellCheckout(false);
      setUpsellFinished(false);
      setPostUrl("");
      setLikesQtyInput("");
      setViewsQtyInput("");
      setPixCode("");
      setPixQrBase64("");
      setPixGateway(null);
      setPixErrorMessage("");
      setOrderId("");
      setCopied(false);
      setStatus("confirmed");
    }, 900);
    return () => clearTimeout(t);
  }, [upsellFinished]);

  const startPolling = useCallback(
    (oid: string, mode: "followers" | "upsell") => {
      if (pollingRef.current) clearInterval(pollingRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const { data, error } = await supabase.functions.invoke("check-payment", {
            body: { order_id: oid },
          });

          if (error) return;

          const s = data?.status?.toLowerCase();
          // placing_smm = pós-PIX enquanto chama SMM; smm_error = PIX ok mas falha SMM (não travar o fluxo).
          if (["paid", "processing", "completed", "placing_smm", "smm_error"].includes(s)) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setStatus("confirmed");
            if (mode === "upsell") {
              setUpsellFinished(true);
              setInUpsellCheckout(false);
            } else {
              followersParentOrderIdRef.current = oid;
            }
          }
        } catch {
          /* ignore */
        }
      }, 5000);
    },
    [],
  );

  useEffect(() => {
    if (status !== "confirmed" || inUpsellCheckout || upsellFinished || upsellDismissed) return;
    if (followersParentOrderIdRef.current === null) return;
    let cancelled = false;
    setUpsellFetchDone(false);
    setUpsellPkgsLoading(true);
    Promise.all([
      supabase.from("packages").select("*").eq("kind", "likes").eq("active", true).order("quantity", { ascending: true }),
      supabase.from("packages").select("*").eq("kind", "views").eq("active", true).order("quantity", { ascending: true }),
    ])
      .then(([likesRes, viewsRes]) => {
        if (cancelled) return;
        const likesRows = (likesRes.data as LikePackageRow[]) || [];
        const viewsRows = (viewsRes.data as LikePackageRow[]) || [];
        setUpsellPkgs(likesRows);
        setUpsellViewsPkgs(viewsRows);
        if (likesRows.length > 0) setSelectedLikePkgId((id) => id ?? likesRows[0].id);
        if (viewsRows.length > 0) setSelectedViewsPkgId((id) => id ?? viewsRows[0].id);
        if (likesRows.length === 0 && viewsRows.length > 0) setUpsellKind("views");
        setUpsellPkgsLoading(false);
        setUpsellFetchDone(true);
      })
      .catch(() => {
        if (cancelled) return;
        setUpsellPkgs([]);
        setUpsellViewsPkgs([]);
        setUpsellPkgsLoading(false);
        setUpsellFetchDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status, inUpsellCheckout, upsellFinished, upsellDismissed]);

  const selectedUpsellPkg =
    upsellKind === "likes"
      ? upsellPkgs.find((p) => p.id === selectedLikePkgId)
      : upsellViewsPkgs.find((p) => p.id === selectedViewsPkgId);

  const likesInputQty = (() => {
    const n = parseInt(likesQtyInput.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : NaN;
  })();
  const likesInputQtyClamped = Number.isFinite(likesInputQty) ? clamp(likesInputQty, 50, 10_000) : NaN;
  const likesInputCents = Number.isFinite(likesInputQtyClamped) ? computeLikesCentsAnyQty(likesInputQtyClamped) : NaN;

  const linkCheck = isValidInstagramLink(upsellKind, postUrl);

  function computeViewsCentsAnyQty(qtyRaw: number): number {
    // Views: mesmo preço das curtidas (tabela fixa)
    return computeLikesCentsAnyQty(qtyRaw);
  }

  const viewsInputQty = (() => {
    const n = parseInt(viewsQtyInput.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : NaN;
  })();
  const viewsInputQtyClamped = Number.isFinite(viewsInputQty) ? clamp(viewsInputQty, 50, 10_000) : NaN;
  const viewsInputCents = Number.isFinite(viewsInputQtyClamped) ? computeViewsCentsAnyQty(viewsInputQtyClamped) : NaN;

  const extractCreatePaymentError = async (
    pdata: {
      success?: boolean;
      error?: string;
      gateway?: string;
      pix?: { qr_code?: string; qr_code_base64?: string };
      order_id?: string;
    } | null,
    fnError: unknown,
  ): Promise<string> => {
    if (pdata?.success === false && typeof pdata.error === "string" && pdata.error) {
      return pdata.error;
    }
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
    const fe = fnError as { name?: string; message?: string };
    if (
      fe.name === "FunctionsFetchError" ||
      (typeof fe.message === "string" && fe.message.includes("Failed to send"))
    ) {
      return await describeEdgeFunctionInvokeError(fnError);
    }
    if (fnError instanceof Error) return fnError.message;
    return "Não foi possível gerar o PIX. Tente de novo.";
  };

  const invokeCreatePayment = async (body: Record<string, unknown>, mode: "followers" | "upsell", upsellType?: UpsellKind) => {
    const amountCents = typeof body.amount === "number" ? body.amount : 0;
    setPaymentMethod("pix");
    setStatus("generating");
    setPixGateway(null);
    setPixErrorMessage("");

    const fail = async (msg: string) => {
      setPixErrorMessage(msg);
      toast.error(msg.length > 180 ? `${msg.slice(0, 180)}…` : msg);
      setStatus("error");
    };

    try {
      const { data: paymentData, error: fnError } = await supabase.functions.invoke("create-payment", {
        body,
      });

      const pdata = paymentData as
        | {
            success?: boolean;
            error?: string;
            gateway?: string;
            pix?: { qr_code?: string; qr_code_base64?: string };
            order_id?: string;
          }
        | null;

      if (pdata?.success === false) {
        await fail(pdata.error || "Erro ao gerar PIX");
        return;
      }

      if (fnError) {
        await fail(await extractCreatePaymentError(pdata, fnError));
        return;
      }

      if (pdata?.pix?.qr_code || pdata?.pix?.qr_code_base64) {
        setPixCode(pdata.pix.qr_code || "");
        setPixQrBase64(pdata.pix.qr_code_base64 || "");
        setPixGateway(pdata.gateway ?? null);
        setOrderId(pdata.order_id || "");
        setStatus("ready");

        if (pdata.order_id) {
          startPolling(pdata.order_id, mode);
          metaPixelInitiateCheckout(
            amountCents / 100,
            mode === "upsell"
              ? (upsellType === "views" ? "visualizacoes_instagram" : "curtidas_instagram")
              : "seguidores_instagram",
          );
        }
      } else {
        await fail(pdata?.error || "Resposta do servidor sem código PIX.");
      }
    } catch (err) {
      console.error("Payment error:", err);
      const msg = err instanceof Error ? err.message : "Erro ao gerar pagamento.";
      setPixErrorMessage(msg);
      setStatus("error");
      toast.error(msg);
    }
  };

  const createPixPayment = async () => {
    const customer = generateFakeCustomer();
    await invokeCreatePayment(
      {
        username,
        quantity,
        amount,
        is_discounted: isDiscounted,
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          document: customer.document.replace(/\D/g, ""),
        },
      },
      "followers",
    );
  };

  const createLikesPixPayment = async () => {
    const pickedFromInput =
      Number.isFinite(likesInputQtyClamped) && Number.isFinite(likesInputCents)
        ? { qty: likesInputQtyClamped, cents: likesInputCents }
        : null;
    if (!pickedFromInput) {
      toast.error("Digite uma quantidade (50 a 10.000)");
      return;
    }
    const normalized = normalizePostUrl(postUrl);
    const chk = isValidInstagramLink("likes", normalized);
    if (!chk.ok) {
      toast.error(chk.hint || "Cole o link do post do Instagram.");
      return;
    }

    const useDisc = false;
    const amt = pickedFromInput.cents;
    const qty = pickedFromInput.qty;

    setUpsellQty(qty);
    setUpsellAmount(amt);
    setUpsellDiscounted(useDisc);
    setUpsellCheckoutKind("likes");
    setInUpsellCheckout(true);

    const customer = generateFakeCustomer();
    await invokeCreatePayment(
      {
        username,
        quantity: qty,
        amount: amt,
        is_discounted: useDisc,
        product_type: "likes",
        post_url: normalized,
        parent_order_id: followersParentOrderIdRef.current || undefined,
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          document: customer.document.replace(/\D/g, ""),
        },
      },
      "upsell",
      "likes",
    );
  };

  const createViewsPixPayment = async () => {
    const picked =
      Number.isFinite(viewsInputQtyClamped) && Number.isFinite(viewsInputCents)
        ? { qty: viewsInputQtyClamped, cents: viewsInputCents }
        : null;
    if (!picked) {
      toast.error("Digite uma quantidade de views (50 a 10.000)");
      return;
    }
    const normalized = normalizePostUrl(postUrl);
    const chk = isValidInstagramLink("views", normalized);
    if (!chk.ok) {
      toast.error(chk.hint || "Cole o link do Reels/vídeo do Instagram.");
      return;
    }
    const useDisc = false;
    const amt = picked.cents;

    setUpsellQty(picked.qty);
    setUpsellAmount(amt);
    setUpsellDiscounted(useDisc);
    setUpsellCheckoutKind("views");
    setInUpsellCheckout(true);

    const customer = generateFakeCustomer();
    await invokeCreatePayment(
      {
        username,
        quantity: picked.qty,
        amount: amt,
        is_discounted: useDisc,
        product_type: "views",
        post_url: normalized,
        parent_order_id: followersParentOrderIdRef.current || undefined,
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          document: customer.document.replace(/\D/g, ""),
        },
      },
      "upsell",
      "views",
    );
  };

  const copyPixCode = () => {
    if (pixCode) {
      navigator.clipboard.writeText(pixCode);
      setCopied(true);
      toast.success("Código Pix copiado!");
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleChangeProfile = () => {
    const newUser = prompt("Digite o novo @usuário:");
    if (newUser && newUser.trim()) {
      const cleanUser = newUser.trim().replace("@", "");
      const path = window.location.pathname;
      const eqIndex = path.indexOf("=");
      const prefix = path.substring(1, eqIndex);
      window.location.href = `/${prefix}=${cleanUser}`;
    }
  };

  const formattedPrice = `R$ ${(amount / 100).toFixed(2).replace(".", ",")}`;
  const formattedUpsellPrice = `R$ ${(upsellAmount / 100).toFixed(2).replace(".", ",")}`;

  const followersApproxLabel =
    profileFollowers != null && Number.isFinite(profileFollowers) && profileFollowers >= 0
      ? `~${Math.round(profileFollowers).toLocaleString("pt-BR")} seguidores agora (aprox.)`
      : null;

  const showUpsellBlock =
    status === "confirmed" &&
    !inUpsellCheckout &&
    !upsellFinished &&
    !upsellDismissed &&
    (!upsellFetchDone || upsellPkgsLoading || upsellPkgs.length > 0);

  const showFollowersOnlySuccess =
    status === "confirmed" &&
    !inUpsellCheckout &&
    !upsellFinished &&
    upsellFetchDone &&
    !upsellPkgsLoading &&
    (upsellPkgs.length === 0 || upsellDismissed);

  const showUpsellPixFlow = inUpsellCheckout && (status === "generating" || status === "ready" || status === "error");

  const showUpsellSuccess = status === "confirmed" && upsellFinished;

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg border-border bg-card p-0 gap-0 overflow-hidden [&>button]:hidden max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {showLikesTutorial && (
          <div
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 p-3 sm:p-4"
            onMouseDown={() => setShowLikesTutorial(false)}
            role="presentation"
          >
            <div
              className="w-full max-w-[26rem] sm:max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden max-h-[86vh]"
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Tutorial de curtidas"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-3 sm:px-4 py-2.5">
                <p className="text-sm font-bold text-foreground truncate">Como copiar o link (Curtidas)</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowLikesTutorial(false)}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLikesTutorial(false)}
                    className="h-8 w-8 rounded-md border border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Fechar tutorial"
                    title="Fechar"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="p-3 overflow-auto">
                <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black/40">
                  {/* Fundo “preenchido” (blur) para não ficar faixa preta quando o vídeo for contain */}
                  <video
                    src="/Likes.mp4"
                    muted
                    playsInline
                    autoPlay
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover blur-2xl opacity-35 scale-110"
                    aria-hidden
                  />
                  {/* Vídeo principal: mostra tutorial inteiro (sem cortar) */}
                  <video
                    src="/Likes.mp4"
                    controls
                    playsInline
                    autoPlay
                    className="relative z-10 h-[60vh] w-full object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {showViewsTutorial && (
          <div
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 p-3 sm:p-4"
            onMouseDown={() => setShowViewsTutorial(false)}
            role="presentation"
          >
            <div
              className="w-full max-w-[26rem] sm:max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden max-h-[86vh]"
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Tutorial de visualizações"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-3 sm:px-4 py-2.5">
                <p className="text-sm font-bold text-foreground truncate">Como copiar o link (Visualizações)</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowViewsTutorial(false)}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowViewsTutorial(false)}
                    className="h-8 w-8 rounded-md border border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Fechar tutorial"
                    title="Fechar"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="p-3 overflow-auto">
                <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black/40">
                  <video
                    src="/Vizu.mp4"
                    muted
                    playsInline
                    autoPlay
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover blur-2xl opacity-35 scale-110"
                    aria-hidden
                  />
                  <video
                    src="/Vizu.mp4"
                    controls
                    playsInline
                    autoPlay
                    className="relative z-10 h-[60vh] w-full object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CHOOSING — seguidores */}
        {paymentMethod === "choosing" && (
          <div className="flex flex-col p-6 gap-5">
            <div className="text-center">
              <div className="flex flex-col items-center gap-1 mb-2">
                <div className="flex items-center justify-center gap-2">
                  {profilePic && (
                    <img src={profilePic} alt={username} className="w-8 h-8 rounded-full object-cover" />
                  )}
                  <span className="text-sm text-foreground font-semibold">@{username}</span>
                </div>
                {followersApproxLabel && (
                  <p className="text-xs text-muted-foreground">{followersApproxLabel}</p>
                )}
              </div>
              <h2 className="text-lg font-bold text-foreground">Comprar {quantity} seguidores brasileiros 🇧🇷</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Valor: <span className="text-primary font-semibold">{formattedPrice}</span>
              </p>
            </div>

            <p className="text-sm font-semibold text-foreground text-center">Pagamento via PIX:</p>

            <button
              onClick={createPixPayment}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-border bg-background hover:border-primary transition-colors group w-full"
            >
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                <QrCode className="h-7 w-7 text-green-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-foreground">Gerar código PIX</p>
                <p className="text-xs text-muted-foreground">Pagamento instantâneo</p>
              </div>
            </button>

            <button onClick={handleChangeProfile} className="text-xs text-primary hover:underline text-center">
              O perfil não é este? Mudar
            </button>
          </div>
        )}

        {/* GENERATING — seguidores */}
        {paymentMethod === "pix" && status === "generating" && !inUpsellCheckout && (
          <div className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="relative w-20 h-20">
              <div
                className="absolute inset-0 rounded-full gradient-instagram animate-spin"
                style={{
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                  WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                }}
              />
              {profilePic && (
                <img src={profilePic} alt={username} className="absolute inset-2 w-16 h-16 rounded-full object-cover" />
              )}
            </div>
            <div className="text-center space-y-1">
              <p className="text-base font-semibold text-foreground">Gerando pagamento...</p>
              <p className="text-sm text-muted-foreground">Preparando Pix para @{username}</p>
              {followersApproxLabel && (
                <p className="text-xs text-muted-foreground">{followersApproxLabel}</p>
              )}
            </div>
          </div>
        )}

        {/* READY — seguidores */}
        {paymentMethod === "pix" && status === "ready" && !inUpsellCheckout && (
          <div className="flex flex-col">
            <div className="px-6 pt-6 pb-4">
              <h2 className="text-lg font-bold text-foreground">Comprar {quantity} seguidores brasileiros 🇧🇷</h2>
              <p className="text-sm text-muted-foreground">
                Valor: <span className="text-primary font-semibold">{formattedPrice}</span>
              </p>
              {pixGateway && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Provedor do PIX:{" "}
                  <span className="font-medium text-foreground">
                    {pixGateway === "skale" ? "SkalePayments" : "X (ExPay)"}
                  </span>
                </p>
              )}
            </div>

            <div className="px-6 pb-4 flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                {profilePic && (
                  <img src={profilePic} alt={username} className="w-6 h-6 rounded-full object-cover" />
                )}
                <span className="text-sm text-foreground">
                  Seguidores para <span className="font-semibold">@{username}</span>
                </span>
              </div>
              {followersApproxLabel && (
                <p className="text-xs text-muted-foreground text-center">{followersApproxLabel}</p>
              )}
              <button onClick={handleChangeProfile} className="text-xs text-primary hover:underline">
                O perfil não é este? Mudar
              </button>
            </div>

            {(pixQrBase64 || pixCode) && (
              <div className="flex justify-center px-6 pb-4">
                <div className="bg-white p-3 rounded-xl inline-block">
                  {pixCode.trim() ? (
                    <PixQRCode
                      value={pixCode}
                      size={192}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                      title="PIX copia e cola"
                    />
                  ) : pixQrBase64 ? (
                    <img
                      src={`data:image/png;base64,${pixQrBase64}`}
                      alt="QR Code Pix"
                      className="w-48 h-48 object-contain"
                    />
                  ) : null}
                </div>
              </div>
            )}

            <div className="px-6 pb-3">
              <p className="text-xs text-muted-foreground text-center mb-2">Copie e pague no app do seu banco:</p>
              <textarea
                readOnly
                value={pixCode}
                className="w-full h-20 bg-muted border border-border rounded-lg p-3 text-xs text-foreground resize-none text-center focus:outline-none"
              />
            </div>

            <div className="px-6 pb-4">
              <button
                onClick={copyPixCode}
                className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                {copied ? (
                  <>
                    <Check className="h-5 w-5" /> Código copiado!
                  </>
                ) : (
                  <>
                    <Copy className="h-5 w-5" /> Copiar código PIX
                  </>
                )}
              </button>
            </div>

            <div className="px-6 pb-4">
              <p className="text-xs font-bold text-muted-foreground text-center mb-3 tracking-wider">COMO PAGAR</p>
              <div className="space-y-2.5">
                <div className="flex items-start gap-3">
                  <span className="text-sm">🏦</span>
                  <p className="text-xs text-muted-foreground">Abra o app do seu banco ou carteira digital</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-sm">📲</span>
                  <p className="text-xs text-muted-foreground">Toque em &quot;Pagar com PIX&quot; e escolha &quot;Copia e Cola&quot;</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-sm">✅</span>
                  <p className="text-xs text-muted-foreground">Cole o código copiado e confirme o pagamento</p>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Aguardando pagamento...</p>
            </div>
          </div>
        )}

        {/* UPSELL (Curtidas/Views): generating / ready / error */}
        {showUpsellPixFlow && status === "generating" && (
          <div className="flex flex-col items-center justify-center py-16 gap-5 px-6">
            <div className="relative w-20 h-20">
              <div
                className="absolute inset-0 rounded-full gradient-instagram animate-spin"
                style={{
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                  WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                }}
              />
              <div
                className={cn(
                  "absolute inset-2 rounded-full flex items-center justify-center",
                  upsellCheckoutKind === "views" ? "bg-secondary/20" : "bg-primary/20",
                )}
              >
                {upsellCheckoutKind === "views" ? (
                  <Eye className="h-8 w-8 text-secondary" />
                ) : (
                  <Heart className="h-8 w-8 text-primary" />
                )}
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-base font-semibold text-foreground">
                {upsellCheckoutKind === "views" ? "Gerando PIX das visualizações..." : "Gerando PIX das curtidas..."}
              </p>
              <p className="text-sm text-muted-foreground">
                {upsellQty} {upsellCheckoutKind === "views" ? "views" : "curtidas"} — {formattedUpsellPrice}
              </p>
            </div>
          </div>
        )}

        {showUpsellPixFlow && status === "ready" && (
          <div className="flex flex-col">
            <div className="px-6 pt-6 pb-4">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                {upsellCheckoutKind === "views" ? (
                  <Eye className="h-5 w-5 text-secondary" />
                ) : (
                  <Heart className="h-5 w-5 text-primary" />
                )}
                {upsellQty} {upsellCheckoutKind === "views" ? "views" : "curtidas"} na sua publicação
              </h2>
              <p className="text-sm text-muted-foreground">
                Valor: <span className="text-primary font-semibold">{formattedUpsellPrice}</span>
              </p>
            </div>

            {(pixQrBase64 || pixCode) && (
              <div className="flex justify-center px-6 pb-4">
                <div className="bg-white p-3 rounded-xl inline-block">
                  {pixCode.trim() ? (
                    <PixQRCode
                      value={pixCode}
                      size={192}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                      title="PIX curtidas"
                    />
                  ) : pixQrBase64 ? (
                    <img
                      src={`data:image/png;base64,${pixQrBase64}`}
                      alt="QR Code Pix"
                      className="w-48 h-48 object-contain"
                    />
                  ) : null}
                </div>
              </div>
            )}

            <div className="px-6 pb-3">
              <textarea
                readOnly
                value={pixCode}
                className="w-full h-20 bg-muted border border-border rounded-lg p-3 text-xs text-foreground resize-none text-center focus:outline-none"
              />
            </div>

            <div className="px-6 pb-6 space-y-3">
              <button
                onClick={copyPixCode}
                className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-lg flex items-center justify-center gap-2"
              >
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                {copied ? "Código copiado!" : "Copiar código PIX"}
              </button>
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Aguardando pagamento...</p>
              </div>
            </div>
          </div>
        )}

        {showUpsellPixFlow && status === "error" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4 px-6">
            <div className="w-14 h-14 rounded-full bg-destructive/20 flex items-center justify-center">
              <X className="h-7 w-7 text-destructive" />
            </div>
            <p className="text-base font-bold text-foreground">
              {upsellCheckoutKind === "views" ? "Erro ao gerar PIX das visualizações" : "Erro ao gerar PIX das curtidas"}
            </p>
            {pixErrorMessage && (
              <p className="text-xs text-destructive/90 text-center max-w-sm break-words">{pixErrorMessage}</p>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setStatus("confirmed");
                setInUpsellCheckout(false);
                setPixErrorMessage("");
              }}
            >
              Voltar à oferta
            </Button>
          </div>
        )}

        {/* CONFIRMED seguidores + upsell */}
        {showUpsellBlock && (
          <div className="flex flex-col py-8 px-6 gap-5">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle className="h-9 w-9 text-emerald-500" />
              </div>
              <h2 className="text-xl font-black text-center text-foreground">Pagamento confirmado!</h2>
              <p className="text-sm text-muted-foreground text-center">
                Seus <span className="text-primary font-bold">{quantity} seguidores</span> estão em processamento para{" "}
                <span className="font-semibold">@{username}</span>.
              </p>
            </div>

            {upsellPkgsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-primary/25 bg-primary/[0.03] p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setUpsellKind("likes")}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        upsellKind === "likes"
                          ? "border-primary/40 bg-primary/10"
                          : "border-border bg-background/40 hover:bg-background/60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-primary" />
                        <p className="text-sm font-bold text-foreground">Curtidas</p>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">Link do post (publicação)</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUpsellKind("views")}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        upsellKind === "views"
                          ? "border-secondary/45 bg-secondary/10"
                          : "border-border bg-background/40 hover:bg-background/60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-secondary" />
                        <p className="text-sm font-bold text-foreground">Visualizações</p>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">Link do Reels/vídeo</p>
                    </button>
                  </div>

                  {upsellKind === "likes" ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Como pegar o link:</span> abra o post → toque em{" "}
                      <span className="font-medium">Compartilhar</span> → <span className="font-medium">Copiar link</span>.{" "}
                      <button
                        type="button"
                        onClick={() => setShowLikesTutorial(true)}
                        className="font-semibold text-primary underline underline-offset-2 hover:opacity-90"
                      >
                        clique aqui e aprenda
                      </button>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Como pegar o link:</span> abra o Reels/vídeo →{" "}
                      <span className="font-medium">Compartilhar</span> → <span className="font-medium">Copiar link</span>.{" "}
                      <button
                        type="button"
                        onClick={() => setShowViewsTutorial(true)}
                        className="font-semibold text-primary underline underline-offset-2 hover:opacity-90"
                      >
                        clique aqui e aprenda
                      </button>
                    </p>
                  )}

                  {upsellKind === "likes" ? (
                    <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
                      <Label className="text-xs text-muted-foreground">Quantidade (50 a 10.000)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={likesQtyInput}
                          onChange={(e) => setLikesQtyInput(e.target.value)}
                          placeholder="Ex.: 500"
                          inputMode="numeric"
                          className="bg-background border-border text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setLikesQtyInput(String(clamp((Number.isFinite(likesInputQtyClamped) ? likesInputQtyClamped : 50) - 50, 50, 10_000)))}
                          className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm font-bold text-foreground hover:bg-background"
                          title="-50"
                        >
                          −50
                        </button>
                        <button
                          type="button"
                          onClick={() => setLikesQtyInput(String(clamp((Number.isFinite(likesInputQtyClamped) ? likesInputQtyClamped : 50) + 50, 50, 10_000)))}
                          className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm font-bold text-foreground hover:bg-background"
                          title="+50"
                        >
                          +50
                        </button>
                      </div>
                      {likesQtyInput.trim() ? (
                        Number.isFinite(likesInputQtyClamped) && Number.isFinite(likesInputCents) ? (
                          <p className="text-xs text-muted-foreground">
                            Valor:{" "}
                            <span className="font-bold text-primary">{formatBRLFromCents(likesInputCents)}</span>
                            <span className="text-muted-foreground/70">
                              {" "}
                              • {Math.round(likesInputQtyClamped).toLocaleString("pt-BR")} curtidas
                            </span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Digite um número (50 a 10.000).</p>
                        )
                      ) : (
                        <p className="text-[11px] text-muted-foreground">Digite uma quantidade e o valor aparece aqui embaixo.</p>
                      )}
                      <input
                        type="range"
                        min={50}
                        max={10000}
                        step={10}
                        value={Number.isFinite(likesInputQtyClamped) ? likesInputQtyClamped : 50}
                        onChange={(e) => setLikesQtyInput(String(e.target.value))}
                        className="mt-2 h-2 w-full cursor-pointer accent-primary range-thumb-airplane"
                        aria-label="Quantidade de curtidas"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
                      <Label className="text-xs text-muted-foreground">Quantidade de views (50 a 10.000)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={viewsQtyInput}
                          onChange={(e) => setViewsQtyInput(e.target.value)}
                          placeholder="Ex.: 1000"
                          inputMode="numeric"
                          className="bg-background border-border text-sm"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setViewsQtyInput(
                              String(
                                clamp(
                                  (Number.isFinite(viewsInputQtyClamped) ? viewsInputQtyClamped : 50) - 100,
                                  50,
                                  10_000,
                                ),
                              ),
                            )
                          }
                          className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm font-bold text-foreground hover:bg-background"
                          title="-100"
                        >
                          −100
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setViewsQtyInput(
                              String(
                                clamp(
                                  (Number.isFinite(viewsInputQtyClamped) ? viewsInputQtyClamped : 50) + 100,
                                  50,
                                  10_000,
                                ),
                              ),
                            )
                          }
                          className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm font-bold text-foreground hover:bg-background"
                          title="+100"
                        >
                          +100
                        </button>
                      </div>
                      {viewsQtyInput.trim() ? (
                        Number.isFinite(viewsInputQtyClamped) && Number.isFinite(viewsInputCents) ? (
                          <p className="text-xs text-muted-foreground">
                            Valor: <span className="font-bold text-primary">{formatBRLFromCents(viewsInputCents)}</span>
                            <span className="text-muted-foreground/70">
                              {" "}
                              • {Math.round(viewsInputQtyClamped).toLocaleString("pt-BR")} views
                            </span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            Valor inválido. Ajuste a quantidade (50 a 10.000).
                          </p>
                        )
                      ) : (
                        <p className="text-[11px] text-muted-foreground">Digite uma quantidade e o valor aparece aqui embaixo.</p>
                      )}
                      <input
                        type="range"
                        min={50}
                        max={10000}
                        step={50}
                        value={Number.isFinite(viewsInputQtyClamped) ? viewsInputQtyClamped : 50}
                        onChange={(e) => setViewsQtyInput(String(e.target.value))}
                        className="mt-2 h-2 w-full cursor-pointer accent-primary range-thumb-airplane"
                        aria-label="Quantidade de visualizações"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {upsellKind === "likes" ? "Link da publicação" : "Link do Reels/vídeo"}
                    </Label>
                    <Input
                      value={postUrl}
                      onChange={(e) => setPostUrl(e.target.value)}
                      placeholder={upsellKind === "likes" ? "https://www.instagram.com/p/..." : "https://www.instagram.com/reel/..."}
                      className="bg-background border-border text-sm"
                    />
                    {postUrl.trim() && !linkCheck.ok && (
                      <p className="text-[11px] text-destructive/90">{linkCheck.hint}</p>
                    )}
                  </div>

                  <Button
                    className="w-full gradient-instagram text-primary-foreground font-bold"
                    onClick={() => void (upsellKind === "likes" ? createLikesPixPayment() : createViewsPixPayment())}
                    disabled={
                      upsellKind === "likes"
                        ? !Number.isFinite(likesInputCents) || !linkCheck.ok
                        : !Number.isFinite(viewsInputCents) || !linkCheck.ok
                    }
                  >
                    <QrCode className="h-4 w-4 mr-2" />
                    {upsellKind === "likes" ? "Gerar PIX das curtidas" : "Gerar PIX das visualizações"}
                  </Button>
                </div>

                <button
                  type="button"
                  onClick={() => setUpsellDismissed(true)}
                  className="text-xs text-muted-foreground hover:text-foreground text-center w-full"
                >
                  Não, obrigado
                </button>
              </>
            )}
          </div>
        )}

        {/* Sucesso só seguidores (sem upsell ou recusou) */}
        {showFollowersOnlySuccess && (
          <div className="flex flex-col items-center justify-center py-12 px-6 gap-5">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center animate-in zoom-in duration-500">
                <CheckCircle className="h-14 w-14 text-emerald-500" />
              </div>
              <div className="absolute -top-2 -right-2">
                <PartyPopper className="h-8 w-8 text-accent animate-in spin-in duration-700" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black text-foreground">Pagamento confirmado!</h2>
              <p className="text-sm text-muted-foreground">
                Seus <span className="text-primary font-bold">{quantity} seguidores</span> estão sendo adicionados ao
                perfil
              </p>
            </div>

            <div className="flex items-center gap-3 bg-muted rounded-xl px-5 py-3">
              {profilePic && (
                <img src={profilePic} alt={username} className="w-10 h-10 rounded-full object-cover" />
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">@{username}</p>
                {followersApproxLabel && (
                  <p className="text-[11px] text-muted-foreground">{followersApproxLabel}</p>
                )}
                <p className="text-xs text-emerald-500 font-medium">+{quantity} seguidores em processamento</p>
              </div>
            </div>

            <div className="w-full space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
                <p className="text-xs text-foreground">Pagamento recebido</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
                <p className="text-xs text-foreground">Pedido confirmado</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full gradient-instagram flex items-center justify-center">
                  <Loader2 className="h-3 w-3 text-primary-foreground animate-spin" />
                </div>
                <p className="text-xs text-foreground">Adicionando seguidores...</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center mt-2">
              Os seguidores serão adicionados em até <span className="font-semibold text-foreground">30 minutos</span>.
              <br />
              Você pode fechar esta página.
            </p>
          </div>
        )}

        {/* Sucesso upsell (Curtidas/Views) */}
        {showUpsellSuccess && (
          <div className="flex flex-col items-center justify-center py-12 px-6 gap-5">
            <div
              className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center",
                upsellCheckoutKind === "views" ? "bg-secondary/20" : "bg-primary/20",
              )}
            >
              {upsellCheckoutKind === "views" ? (
                <Eye className="h-10 w-10 text-secondary" />
              ) : (
                <Heart className="h-10 w-10 text-primary" />
              )}
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black text-foreground">
                {upsellCheckoutKind === "views" ? "Visualizações confirmadas!" : "Curtidas confirmadas!"}
              </h2>
              <p className="text-sm text-muted-foreground">
                <span className="text-primary font-bold">
                  {upsellQty} {upsellCheckoutKind === "views" ? "views" : "curtidas"}
                </span>{" "}
                serão enviadas para a publicação informada.
              </p>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Processamento em até <span className="font-semibold text-foreground">30 minutos</span>. Você pode fechar
              esta página.
            </p>
            <Button
              onClick={() => {
                setUpsellFinished(false);
                setInUpsellCheckout(false);
                setPostUrl("");
                setLikesQtyInput("");
                setViewsQtyInput("");
                setPixCode("");
                setPixQrBase64("");
                setPixGateway(null);
                setPixErrorMessage("");
                setOrderId("");
                setCopied(false);
                setStatus("confirmed");
              }}
              className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-lg"
            >
              Comprar para outra postagem
            </Button>
          </div>
        )}

        {/* ERROR — seguidores */}
        {paymentMethod === "pix" && status === "error" && !inUpsellCheckout && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-14 h-14 rounded-full bg-destructive/20 flex items-center justify-center">
              <X className="h-7 w-7 text-destructive" />
            </div>
            <p className="text-base font-bold text-foreground">Erro ao gerar pagamento</p>
            {pixErrorMessage ? (
              <p className="text-xs text-destructive/90 text-center max-w-sm px-2 break-words leading-relaxed">
                {pixErrorMessage}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground text-center">Recarregue a página para tentar novamente</p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="gradient-instagram text-primary-foreground font-semibold px-6 py-2.5 rounded-lg"
            >
              Recarregar
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
