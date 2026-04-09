import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LimitedOfferBar } from "@/components/LimitedOfferBar";
import { describeEdgeFunctionInvokeError } from "@/lib/edge-function-invoke-error";
import { normalizeInstagramUsername } from "@/lib/instagram-username";
import { sortPackagesLikeWhatsappList } from "@/lib/whatsapp-follower-packages";
import { cn } from "@/lib/utils";
import { Heart, Loader2, Instagram, ArrowRight, Search, Sparkles } from "lucide-react";

const rawProfileMs = Number(import.meta.env.VITE_PROFILE_FETCH_TIMEOUT_MS);
const PROFILE_FETCH_MS = Number.isFinite(rawProfileMs)
  ? Math.min(Math.max(rawProfileMs, 8_000), 30_000)
  : 12_000;
interface PackageData {
  id: string;
  quantity: number;
  price: number;
  discount_price: number | null;
}

export default function Index() {
  const navigate = useNavigate();
  const location = useLocation();
  const kind = useMemo<"seg">(() => "seg", []);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"username" | "packages">("username");
  const [username, setUsername] = useState("");
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profileUsedFallback, setProfileUsedFallback] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [likePackages, setLikePackages] = useState<PackageData[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  // (somente seguidores nesta página)

  const fetchProfile = async () => {
    if (kind !== "seg") return;
    const user = normalizeInstagramUsername(username);
    if (!user) {
      setProfileError("Digite um nome de usuário válido (sem só espaços ou caracteres invisíveis).");
      return;
    }

    setProfileLoading(true);
    setProfileError("");
    usernameInputRef.current?.blur();

    try {
      const race = await Promise.race([
        supabase.functions
          .invoke("fetch-profile", {
            body: { instagram_username: user, user, username: user, lite: true },
          })
          .then((r) => ({ tag: "ok" as const, ...r })),
        new Promise<{ tag: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ tag: "timeout" }), PROFILE_FETCH_MS),
        ),
      ]);

      if (race.tag === "timeout") {
        setProfileError("A busca demorou demais. Tente de novo ou confira se o @ está correto, sem espaços.");
        return;
      }

      const { data: rawData, error: fnError } = race;
      if (fnError) {
        setProfileError(await describeEdgeFunctionInvokeError(fnError));
        return;
      }

      const data = (rawData ?? {}) as {
        ok?: boolean;
        error?: string;
        profile_pic?: string;
        profile_source?: string;
      };
      if (data.ok) {
        usernameInputRef.current?.blur();
        if (typeof document !== "undefined") {
          const ae = document.activeElement;
          if (ae instanceof HTMLElement) ae.blur();
        }
        setProfilePic(data.profile_pic || null);
        setProfileUsedFallback(data.profile_source === "fallback");
        setUsername(user);
        loadPackages();
        setStep("packages");
      } else {
        setProfileError(
          typeof data.error === "string" && data.error
            ? data.error
            : "Perfil não encontrado. Verifique o nome de usuário.",
        );
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setProfileError("A busca demorou demais. Tente de novo ou confira se o @ está correto, sem espaços.");
      } else {
        setProfileError("Erro ao buscar perfil. Tente novamente.");
      }
    } finally {
      setProfileLoading(false);
    }
  };

  const loadPackages = async () => {
    setPackagesLoading(true);
    const [followersRes, likesRes] = await Promise.all([
      supabase
        .from("packages")
        .select("*")
        .eq("kind", "followers")
        .eq("active", true)
        .order("quantity", { ascending: true }),
      supabase
        .from("packages")
        .select("*")
        .eq("kind", "likes")
        .eq("active", true)
        .order("quantity", { ascending: true }),
    ]);

    if (followersRes.data) setPackages(sortPackagesLikeWhatsappList(followersRes.data));
    if (likesRes.data) setLikePackages(likesRes.data);
    setPackagesLoading(false);
  };

  const handleSelectPackage = (pkg: PackageData) => {
    if (kind !== "seg") return;
    navigate(`/${pkg.quantity}=${username}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") fetchProfile();
  };

  const formatPrice = (cents: number) =>
    `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

  const headerTitle = "Comprar Seguidores";
  const headerDesc = "Para qual perfil você deseja comprar seguidores?";

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col items-center overflow-x-hidden px-4",
        /* Celular: altura = viewport pequena (svh), sem min-h 100dvh + pb-32 que geravam rolagem no vazio */
        "h-[100svh] max-h-[100svh]",
        step === "packages" ? "overflow-y-auto" : "overflow-y-hidden",
        /* Espaço para LimitedOfferBar fixa no topo (safe-area + altura da faixa ~3.25–3.5rem) */
        "pt-[calc(env(safe-area-inset-top,0px)+3.5rem)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
        "md:h-auto md:max-h-none md:min-h-[100dvh] md:overflow-y-visible md:justify-start md:gap-10 md:pb-32 md:pt-[calc(env(safe-area-inset-top,0px)+5.75rem)] lg:pt-[calc(env(safe-area-inset-top,0px)+6.25rem)]",
      )}
    >
      {/* Mobile: hero + card centralizados na tela; desktop: fluxo normal de cima para baixo */}
      <div
        className={cn(
          "flex w-full flex-col items-center",
          step === "username" &&
            "min-h-0 flex-1 justify-center gap-5 overflow-hidden md:flex-none md:justify-start md:gap-10 md:overflow-visible",
        )}
      >
      {step === "username" && (
        <header className="w-full min-w-0 max-w-lg shrink-0 text-center select-text sm:max-w-xl md:mx-auto md:max-w-3xl">
          <h1 className="text-balance text-xl font-extrabold leading-snug tracking-tight text-primary sm:text-2xl md:text-[2rem] md:leading-[1.2] lg:text-4xl">
            Transforme seu perfil em uma máquina de engajamento e autoridade
          </h1>
          <p className="text-pretty mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base md:mt-3 md:text-lg">
            Atraia marcas, empresas e clientes que querem investir no seu sucesso.
          </p>
        </header>
      )}

      <section
        className="w-full min-w-0 max-w-md mx-auto rounded-xl border border-border bg-card shadow-xl shadow-black/40 overflow-hidden relative z-10 box-border"
        aria-label={headerTitle}
      >
          {step === "username" && (
            <div className="flex flex-col p-6 gap-5">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="w-16 h-16 mx-auto rounded-full gradient-instagram flex items-center justify-center">
                  <Instagram className="h-8 w-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold text-foreground">{headerTitle}</h2>
                <p className="text-sm text-muted-foreground">{headerDesc}</p>
              </div>

              {/* Input */}
              <div className="space-y-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                  <input
                    ref={usernameInputRef}
                    type="text"
                    inputMode="text"
                    autoComplete="username"
                    enterKeyHint="search"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="nome.de.usuario"
                    className="w-full bg-muted border border-border rounded-lg pl-8 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50"
                  />
                </div>

                {profileError && (
                  <p className="text-xs text-destructive text-center">{profileError}</p>
                )}

                <button
                  onClick={fetchProfile}
                  disabled={!username.trim() || profileLoading}
                  className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {profileLoading ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> Buscando perfil...</>
                  ) : (
                    <><Search className="h-5 w-5" /> Buscar perfil</>
                  )}
                </button>

              </div>
            </div>
          )}

          {step === "packages" && (
            <div className="flex flex-col">
              {/* Profile header */}
              <div className="px-6 pt-6 pb-4 flex items-center gap-3">
                {profilePic && (
                  <img
                    src={profilePic}
                    alt={username}
                    className="w-12 h-12 rounded-full object-cover border-2 border-border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div>
                  <p className="text-base font-bold text-foreground">@{username}</p>
                  <button
                    onClick={() => {
                      setStep("username");
                      setProfilePic(null);
                      setProfileUsedFallback(false);
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Trocar perfil
                  </button>
                </div>
              </div>

              {profileUsedFallback && (
                <p className="mx-6 mb-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                  Prévia básica: o serviço de dados do Instagram não respondeu. Confirme o @ e continue — ou configure{" "}
                  <span className="font-mono text-foreground/90">PROFILE_API_BASE</span> nos secrets do Supabase para
                  foto e métricas reais.
                </p>
              )}

              <div className="px-6 pb-2">
                <h3 className="text-sm font-bold text-foreground">Escolha um pacote</h3>
              </div>

              {/* Packages list */}
              <div className="px-6 pb-6">
                {packagesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {packages.map((pkg) => (
                      <button
                        key={pkg.id}
                        onClick={() => handleSelectPackage(pkg)}
                        className="w-full flex items-center justify-between bg-muted hover:bg-muted/80 border border-border rounded-lg px-4 py-3 transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full gradient-instagram flex items-center justify-center text-primary-foreground text-xs font-bold">
                            {pkg.quantity >= 1000 ? `${pkg.quantity / 1000}K` : pkg.quantity}
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-semibold text-foreground">
                              {pkg.quantity.toLocaleString("pt-BR")} seguidores
                            </p>
                            {pkg.discount_price && (
                              <p className="text-xs text-muted-foreground line-through">
                                {formatPrice(pkg.price)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-primary">
                            {formatPrice(pkg.discount_price ?? pkg.price)}
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Upsell: curtidas (mesma oferta do pós-PIX) */}
                {!packagesLoading && (
                  <div className="mt-6 space-y-4 border-t border-border pt-5">
                    <div className="rounded-lg border border-primary/20 bg-primary/[0.06] p-4">
                      <div className="flex items-start gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                          <Heart className="h-4 w-4" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                            Curtidas na publicação
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                          </p>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Depois que o pagamento dos{" "}
                            <span className="font-medium text-foreground">seguidores</span> for confirmado, você pode
                            gerar um <span className="font-medium text-primary">segundo PIX</span> para curtidas —
                            basta colar o link do post. Valores de referência:
                          </p>
                          {likePackages.length > 0 ? (
                            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2" aria-label="Pacotes de curtidas">
                              {likePackages.slice(0, 6).map((p) => (
                                <li
                                  key={p.id}
                                  className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-background/60 px-3 py-2 text-xs"
                                >
                                  <span className="font-semibold text-foreground">
                                    {p.quantity.toLocaleString("pt-BR")} curtidas
                                  </span>
                                  <span className="shrink-0 font-bold text-primary">
                                    {formatPrice(p.discount_price ?? p.price)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Oferta ativa após o PIX; pacotes configurados no painel aparecem aqui.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
      </section>
      </div>

      <LimitedOfferBar />
    </div>
  );
}
