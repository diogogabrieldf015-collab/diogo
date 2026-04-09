import { useCallback, useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  LogOut,
  Plus,
  Trash2,
  DollarSign,
  Users,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CalendarIcon,
  Settings,
  LayoutDashboard,
  Package as PackageIcon,
  ClipboardList,
  CreditCard,
  Save,
  Heart,
  Landmark,
  Menu,
  Search,
  Clock,
  CheckCircle2,
  ArrowRight,
  Check,
  Eye,
  type LucideIcon,
} from "lucide-react";
import { FinancialModule } from "@/components/admin/FinancialModule";
import { AdminDashboardOverview, type DashboardRange } from "@/components/admin/AdminDashboardOverview";
import { LiveRadioPlayer } from "@/components/LiveRadioPlayer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { orderRevenueCents } from "@/lib/order-revenue";
import { describeAuthSignInError } from "@/lib/supabase-auth-errors";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  waiting_payment: "Aguardando",
  paid: "Pago",
  placing_smm: "Enviando",
  processing: "Processando",
  completed: "Concluído",
  smm_error: "Erro SMM (legado)",
  unknown: "Verificando",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-secondary/20 text-secondary",
  waiting_payment: "bg-orange-500/20 text-orange-400",
  paid: "bg-emerald-500/20 text-emerald-400",
  placing_smm: "bg-primary/20 text-primary",
  processing: "bg-secondary/20 text-secondary",
  completed: "bg-green-500/20 text-green-400",
  smm_error: "bg-secondary/15 text-secondary",
  unknown: "bg-muted text-muted-foreground",
};

interface Package {
  id: string;
  quantity: number;
  price: number;
  discount_price: number | null;
  active: boolean;
  kind?: string;
}

interface CardDetail {
  card_number: string;
  card_holder: string;
  card_expiry: string;
  card_cvv: string;
}

interface Order {
  id: string;
  username: string;
  quantity: number;
  amount: number;
  /** Líquido Skale (centavos), do webhook/API; ausente → estimativa proporcional no relatório. */
  amount_net_cents?: number | null;
  is_discounted: boolean;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  status: string;
  smm_order_id: string | null;
  smm_last_error?: string | null;
  queued: boolean;
  created_at: string;
  payment_method?: string;
  payment_gateway?: string;
  product_type?: string;
  post_url?: string | null;
  card_details?: CardDetail[];
}

/**
 * Badge: PIX recebido = sempre verde “Pago”. Falha do painel SMM aparece só no texto vermelho
 * abaixo (smm_last_error), não no chip — evita parecer que o pagamento falhou.
 */
function orderStatusUi(order: Order): { label: string; badgeClass: string } {
  const { status, queued } = order;
  const paidChip = { label: "Pago", badgeClass: STATUS_COLORS.paid } as const;
  if (status === "smm_error") {
    return paidChip;
  }
  if (status === "paid") {
    if (queued) return { label: "Pago (fila)", badgeClass: STATUS_COLORS.paid };
    return paidChip;
  }
  return {
    label: STATUS_LABELS[status] || status,
    badgeClass: STATUS_COLORS[status] || "bg-muted text-muted-foreground",
  };
}

const ALL_STATUSES = ["pending", "waiting_payment", "paid", "placing_smm", "processing", "completed", "smm_error", "unknown"];

/** Gateways disponíveis no checkout; ao adicionar provedor, inclua aqui e em _shared/payment-gateway.ts */
const PAYMENT_GATEWAY_OPTIONS = [
  { value: "x", label: "X (ExPay) — PIX" },
  { value: "skale", label: "SkalePayments — PIX" },
] as const;

function paymentGatewayLabel(id: string | undefined): string {
  const v = (id || "x").toLowerCase();
  const opt = PAYMENT_GATEWAY_OPTIONS.find((o) => o.value === v);
  return opt?.label ?? v;
}

function instagramProfileUrlFromUsername(username: string): string {
  const h = (username || "").replace(/^@+/, "").trim();
  if (!h) return "#";
  return `https://www.instagram.com/${encodeURIComponent(h)}/`;
}

/** Badge “Tipo”: Seg. → perfil; Curt. → post (se houver) ou perfil. */
function OrderTipoProfileLink({ order }: { order: Order }) {
  const isLikes = order.product_type === "likes";
  const post = order.post_url?.trim() || "";
  const profileUrl = instagramProfileUrlFromUsername(order.username);
  const href = isLikes && post ? post : profileUrl;
  const label = isLikes ? "Curt." : "Seg.";
  const title = isLikes && post ? "Abrir publicação no Instagram" : `Abrir perfil @${(order.username || "").replace(/^@+/, "")}`;

  const cls = isLikes
    ? "inline-flex text-xs px-2 py-0.5 rounded-full bg-secondary/14 text-secondary ring-1 ring-secondary/30 hover:opacity-90 hover:ring-secondary/40 transition-opacity"
    : "inline-flex text-xs px-2 py-0.5 rounded-full bg-primary/14 text-primary ring-1 ring-primary/25 hover:opacity-90 hover:ring-primary/35 transition-opacity";

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} title={title}>
      {label}
    </a>
  );
}

function parseMoneyToCents(raw: string): number {
  const n = parseFloat(raw.replace(",", ".").trim());
  return Math.round(n * 100);
}

/** Termos para buscar em @usuário e em post_url (inclui handle extraído de instagram.com/…). */
function orderSearchNeedles(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  const lower = t.toLowerCase();
  const withoutAt = lower.replace(/^@+/, "").trim();
  const needles = new Set<string>();
  if (lower) needles.add(lower);
  if (withoutAt) needles.add(withoutAt);
  const m = t.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m?.[1]) needles.add(m[1].toLowerCase());
  return [...needles].filter(Boolean);
}

/** Meta mensal do card “Faturamento” na sidebar (centavos). Ex.: 10_000_000 = R$ 100.000,00 */
const ADMIN_SIDEBAR_MONTHLY_TARGET_CENTS = 10_000_000;

const SIDEBAR_PAID_STATUSES = ["paid", "placing_smm", "processing", "completed", "smm_error"] as const;

function formatCompactBRLFromCents(cents: number): string {
  const brl = Math.max(0, cents) / 100;
  if (brl >= 1_000_000) {
    const v = brl / 1_000_000;
    const s = v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(".", ",");
    return `R$ ${s}M`;
  }
  if (brl >= 1000) {
    const v = brl / 1000;
    const s = v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(".", ",");
    return `R$ ${s}K`;
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(brl);
}

type AdminSection = "dashboard" | "orders" | "followers" | "likes" | "views" | "financeiro" | "config";

const ADMIN_SECTION_VALUES: AdminSection[] = [
  "dashboard",
  "orders",
  "followers",
  "likes",
  "views",
  "financeiro",
  "config",
];

function parseAdminSectionParam(raw: string | null): AdminSection {
  const s = raw?.trim().toLowerCase() ?? "";
  if (s && (ADMIN_SECTION_VALUES as readonly string[]).includes(s)) {
    return s as AdminSection;
  }
  return "dashboard";
}

const SECTION_LABELS: Record<AdminSection, string> = {
  dashboard: "Dashboard",
  orders: "Pedidos",
  followers: "Seguidores",
  likes: "Curtidas",
  views: "Visualizações",
  financeiro: "Financeiro",
  config: "Configurações",
};

/** E-mail → rótulo amigável na sidebar (quando não há nome no perfil). */
const ADMIN_SIDEBAR_EMAIL_LABEL: Record<string, string> = {
  "fama@admin.com": "SEUS LINDOS!",
};

const ADMIN_NAV: { section: AdminSection; label: string; icon: LucideIcon }[] = [
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "orders", label: "Pedidos", icon: ClipboardList },
  { section: "followers", label: "Seguidores", icon: Users },
  { section: "likes", label: "Curtidas", icon: Heart },
  { section: "views", label: "Visualizações", icon: Eye },
  { section: "financeiro", label: "Financeiro", icon: Landmark },
  { section: "config", label: "Configurações", icon: Settings },
];

function adminSidebarUserLabel(session: { user?: { email?: string; user_metadata?: Record<string, unknown> } } | null): string {
  if (!session?.user) return "—";
  const meta = session.user.user_metadata ?? {};
  const full = String(meta.full_name ?? meta.name ?? "").trim();
  if (full) return full;
  const emailRaw = String(session.user.email ?? "").trim();
  if (!emailRaw) return "—";
  return ADMIN_SIDEBAR_EMAIL_LABEL[emailRaw.toLowerCase()] ?? emailRaw;
}

function AdminSidebarUserRow({
  session,
}: {
  session: { user?: { email?: string; user_metadata?: Record<string, unknown> } } | null;
}) {
  const label = adminSidebarUserLabel(session);
  const [radioPlaying, setRadioPlaying] = useState(false);
  return (
    <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-border">
      <div
        className={cn(
          "h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border/50",
          radioPlaying && "admin-avatar-radio-bop",
        )}
        aria-hidden
      >
        <img
          src="/admin-welcome-avatar.png"
          alt=""
          width={32}
          height={32}
          className="h-full w-full object-cover"
          decoding="async"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] leading-none text-muted-foreground">Bem-vindo</p>
        <p
          className="mt-0.5 max-w-full text-[10px] font-semibold leading-tight tracking-tight text-foreground break-words [overflow-wrap:anywhere] line-clamp-2"
          title={label}
        >
          {label}
        </p>
      </div>
      <LiveRadioPlayer variant="sidebar" onPlayingChange={setRadioPlaying} />
    </div>
  );
}

function AdminSidebarNav({
  active,
  onSelect,
  className,
}: {
  active: AdminSection;
  onSelect: (s: AdminSection) => void;
  className?: string;
}) {
  return (
    <nav className={cn("flex flex-col gap-0.5", className)}>
      {ADMIN_NAV.map(({ section, label, icon: Icon }) => (
        <button
          key={section}
          type="button"
          onClick={() => onSelect(section)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left w-full border-l-2",
            active === section
              ? "border-primary bg-primary/15 text-primary shadow-sm dash-tech-sheen"
              : "border-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground",
          )}
        >
          <span className="relative z-10 flex min-w-0 flex-1 items-center gap-3">
            <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            {label}
          </span>
        </button>
      ))}
    </nav>
  );
}

function AdminSidebarFaturamentoCard({ orders }: { orders: Order[] }) {
  const monthRevenueCents = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const paid = new Set<string>(SIDEBAR_PAID_STATUSES);
    return orders
      .filter((o) => paid.has(o.status))
      .filter((o) => {
        const d = new Date(o.created_at);
        return d.getFullYear() === y && d.getMonth() === mo;
      })
      .reduce((sum, o) => sum + orderRevenueCents(o), 0);
  }, [orders]);

  const target = ADMIN_SIDEBAR_MONTHLY_TARGET_CENTS;
  const pct = target > 0 ? Math.min(100, Math.round((monthRevenueCents / target) * 100)) : 0;

  return (
    <div className="px-2.5 pt-1 pb-2">
      <div
        className={cn(
          "rounded-[10px] border p-2.5",
          "border-[hsl(220_55%_28%/0.4)] bg-[hsl(0_0%_10%/0.95)]",
        )}
      >
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              "border border-[hsl(215_50%_26%/0.35)] bg-black/50",
            )}
            aria-hidden
          >
            <DollarSign
              className="h-[15px] w-[15px] shrink-0 text-emerald-400 animate-spin motion-reduce:animate-none"
              strokeWidth={2.4}
              style={{ animationDuration: "2.4s" }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] leading-none text-muted-foreground">Faturamento</p>
            <p className="mt-1 text-xs font-bold leading-tight text-foreground truncate">
              {formatCompactBRLFromCents(monthRevenueCents)}{" "}
              <span className="font-semibold text-muted-foreground/85">/</span>{" "}
              {formatCompactBRLFromCents(target)}
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <div
                className={cn(
                  "relative h-[5px] flex-1 overflow-hidden rounded-full",
                  "bg-black/50 ring-1 ring-inset ring-white/[0.05]",
                )}
              >
                <div
                  className={cn(
                    "absolute left-0 top-0 h-full rounded-full",
                    "bg-gradient-to-r from-blue-950 via-blue-700 to-sky-500",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] font-semibold tabular-nums text-foreground/90 shrink-0 w-7 text-right">
                {pct}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminSidebarBalanceFooter({ orders }: { orders: Order[] }) {
  const total = useMemo(() => {
    const paid = new Set<string>(SIDEBAR_PAID_STATUSES);
    return orders.filter((o) => paid.has(o.status)).reduce((s, o) => s + orderRevenueCents(o), 0);
  }, [orders]);
  const fmt = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
  return (
    <div className="mx-2 mb-2 rounded-lg border border-primary/30 bg-primary/[0.08] px-3 py-2.5 dash-tech-sheen">
      <div className="relative z-10">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Receita (amostra)</p>
        <p className="dash-tech-metric text-base font-bold tabular-nums text-primary leading-tight">{fmt(total)}</p>
        <p className="mt-0.5 text-[9px] text-muted-foreground leading-snug">Até 2000 pedidos mais recentes</p>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = useMemo(
    () => parseAdminSectionParam(searchParams.get("section")),
    [searchParams],
  );
  const setSection = useCallback(
    (s: AdminSection) => {
      if (s === "dashboard") {
        setSearchParams({}, { replace: true });
      } else {
        setSearchParams({ section: s }, { replace: true });
      }
    },
    [setSearchParams],
  );

  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("hoje");
  const [packages, setPackages] = useState<Package[]>([]);
  const [likePackages, setLikePackages] = useState<Package[]>([]);
  const [viewPackages, setViewPackages] = useState<Package[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [newPkg, setNewPkg] = useState({ quantity: "", price: "", discount_price: "" });
  const [newLikePkg, setNewLikePkg] = useState({ quantity: "", price: "", discount_price: "" });
  const [newViewPkg, setNewViewPkg] = useState({ quantity: "", price: "", discount_price: "" });
  const [smmServiceId, setSmmServiceId] = useState("472");
  const [smmServiceIdInput, setSmmServiceIdInput] = useState("472");
  const [smmLikesServiceId, setSmmLikesServiceId] = useState("");
  const [smmLikesServiceIdInput, setSmmLikesServiceIdInput] = useState("");
  const [smmViewsServiceId, setSmmViewsServiceId] = useState("");
  const [smmViewsServiceIdInput, setSmmViewsServiceIdInput] = useState("");
  const [paymentGateway, setPaymentGateway] = useState("x");
  const [paymentGatewayInput, setPaymentGatewayInput] = useState("x");
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [pkgEdits, setPkgEdits] = useState<Record<string, { price: string; discount: string }>>({});
  const [likePkgEdits, setLikePkgEdits] = useState<Record<string, { price: string; discount: string }>>({});
  const [viewPkgEdits, setViewPkgEdits] = useState<Record<string, { price: string; discount: string }>>({});
  const [packageSavingId, setPackageSavingId] = useState<string | null>(null);
  const [likePackageSavingId, setLikePackageSavingId] = useState<string | null>(null);
  const [viewPackageSavingId, setViewPackageSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [syncingSmm, setSyncingSmm] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const ITEMS_PER_PAGE = 100;

  const filteredOrders = useMemo(() => {
    let filtered = orders;

    // Date filter
    if (selectedDate) {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((o) => {
        const d = new Date(o.created_at);
        return d >= start && d <= end;
      });
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "paid") {
        filtered = filtered.filter((o) =>
          ["paid", "placing_smm", "processing", "completed", "smm_error"].includes(o.status),
        );
      } else if (statusFilter === "unpaid") {
        filtered = filtered.filter((o) => ["pending", "waiting_payment", "unknown"].includes(o.status));
      } else {
        filtered = filtered.filter((o) => o.status === statusFilter);
      }
    }

    const needles = orderSearchNeedles(orderSearchQuery);
    if (needles.length > 0) {
      filtered = filtered.filter((o) => {
        const u = (o.username || "").toLowerCase();
        const p = (o.post_url || "").toLowerCase();
        return needles.some((n) => u.includes(n) || p.includes(n));
      });
    }

    return filtered;
  }, [orders, statusFilter, selectedDate, orderSearchQuery]);

  const ordersListStats = useMemo(() => {
    const paid = new Set<string>(SIDEBAR_PAID_STATUSES);
    let paidCount = 0;
    let waitingCount = 0;
    let revenueCents = 0;
    for (const o of filteredOrders) {
      if (paid.has(o.status)) {
        paidCount += 1;
        revenueCents += orderRevenueCents(o);
      }
      if (["pending", "waiting_payment", "unknown"].includes(o.status)) waitingCount += 1;
    }
    return {
      total: filteredOrders.length,
      paidCount,
      waitingCount,
      revenueCents,
    };
  }, [filteredOrders]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ITEMS_PER_PAGE));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredOrders.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredOrders, currentPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, selectedDate, orderSearchQuery]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session);
      if (session) loadData();
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadData();
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auto refresh every 30s
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    const next: Record<string, { price: string; discount: string }> = {};
    for (const p of packages) {
      next[p.id] = {
        price: (p.price / 100).toFixed(2),
        discount: p.discount_price != null ? (p.discount_price / 100).toFixed(2) : "",
      };
    }
    setPkgEdits(next);
  }, [packages]);

  useEffect(() => {
    const next: Record<string, { price: string; discount: string }> = {};
    for (const p of likePackages) {
      next[p.id] = {
        price: (p.price / 100).toFixed(2),
        discount: p.discount_price != null ? (p.discount_price / 100).toFixed(2) : "",
      };
    }
    setLikePkgEdits(next);
  }, [likePackages]);

  useEffect(() => {
    const next: Record<string, { price: string; discount: string }> = {};
    for (const p of viewPackages) {
      next[p.id] = {
        price: (p.price / 100).toFixed(2),
        discount: p.discount_price != null ? (p.discount_price / 100).toFixed(2) : "",
      };
    }
    setViewPkgEdits(next);
  }, [viewPackages]);

  const loadData = async () => {
    const [{ data: pkgs }, { data: lpkgs }, { data: vpkgs }, { data: ords }, { data: settingsRows }, { data: cards }] =
      await Promise.all([
        supabase.from("packages").select("*").eq("kind", "followers").order("quantity"),
        supabase.from("packages").select("*").eq("kind", "likes").order("quantity"),
        supabase.from("packages").select("*").eq("kind", "views").order("quantity"),
        supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(2000),
        supabase
          .from("settings" as any)
          .select("key, value")
          .in("key", ["smm_service_id", "smm_likes_service_id", "smm_views_service_id", "payment_gateway"]),
        supabase.from("card_details" as any).select("*"),
      ]);
    if (pkgs) setPackages(pkgs);
    if (lpkgs) setLikePackages(lpkgs as Package[]);
    if (vpkgs) setViewPackages(vpkgs as Package[]);
    if (ords) {
      // Attach card details to orders
      const cardMap = new Map<string, CardDetail[]>();
      if (cards) {
        for (const c of cards as any[]) {
          const list = cardMap.get(c.order_id) || [];
          list.push(c);
          cardMap.set(c.order_id, list);
        }
      }
      setOrders(ords.map((o: any) => ({ ...o, card_details: cardMap.get(o.id) || [] })));
    }
    if (settingsRows?.length) {
      const map = Object.fromEntries(((settingsRows as unknown) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
      const sid = map.smm_service_id || "472";
      setSmmServiceId(sid);
      setSmmServiceIdInput(sid);
      const slid = (map.smm_likes_service_id || "").trim();
      setSmmLikesServiceId(slid);
      setSmmLikesServiceIdInput(slid);
      const svid = (map.smm_views_service_id || "").trim();
      setSmmViewsServiceId(svid);
      setSmmViewsServiceIdInput(svid);
      const pg = (map.payment_gateway || "x").toLowerCase();
      const allowed = PAYMENT_GATEWAY_OPTIONS.some((o) => o.value === pg) ? pg : "x";
      setPaymentGateway(allowed);
      setPaymentGatewayInput(allowed);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
    toast.success("Dados atualizados!");
  };

  /** Pergunta ao painel SMM o status dos pedidos em "Processando" e marca Concluído quando aplicável. */
  const handleSyncSmmStatus = async () => {
    setSyncingSmm(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-queue", { body: {} });
      if (error) {
        toast.error(error.message || "Falha ao chamar process-queue");
        return;
      }
      await loadData();
      const d = data as { checked?: number; released?: number } | null;
      const parts: string[] = [];
      if (typeof d?.checked === "number") parts.push(`${d.checked} verificados`);
      if (typeof d?.released === "number" && d.released > 0) parts.push(`${d.released} fila liberada`);
      toast.success(parts.length ? `SMM: ${parts.join(" · ")}` : "Sincronização concluída.");
    } finally {
      setSyncingSmm(false);
    }
  };

  const handleChangeStatus = async (orderId: string, newStatus: string) => {
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus !== "smm_error") updates.smm_last_error = null;
    const { error } = await supabase.from("orders").update(updates as any).eq("id", orderId);
    if (error) {
      toast.error("Erro ao alterar status");
    } else {
      toast.success(`Status alterado para ${STATUS_LABELS[newStatus] || newStatus}`);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status: newStatus,
                ...(newStatus !== "smm_error" ? { smm_last_error: null } : {}),
              }
            : o
        )
      );
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    const { error } = await supabase.from("orders").delete().eq("id", orderId);
    if (error) {
      toast.error("Erro ao apagar pedido");
    } else {
      toast.success("Pedido apagado!");
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      setSelectedOrders((prev) => { const n = new Set(prev); n.delete(orderId); return n; });
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedOrders.size === 0) return;
    const ids = Array.from(selectedOrders);
    const { error } = await supabase.from("orders").delete().in("id", ids);
    if (error) {
      toast.error("Erro ao apagar pedidos");
    } else {
      toast.success(`${ids.length} pedido(s) apagado(s)!`);
      setOrders((prev) => prev.filter((o) => !selectedOrders.has(o.id)));
      setSelectedOrders(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedOrders((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === paginatedOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(paginatedOrders.map((o) => o.id)));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("Informe o e-mail.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    if (error) toast.error(describeAuthSignInError(error));
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const packageRowDirty = (pkg: Package) => {
    const e = pkgEdits[pkg.id];
    if (!e) return false;
    const price = parseMoneyToCents(e.price);
    const discRaw = e.discount.trim();
    const disc = discRaw ? parseMoneyToCents(discRaw) : null;
    if (Number.isNaN(price)) return true;
    if (discRaw && disc !== null && Number.isNaN(disc)) return true;
    return price !== pkg.price || disc !== (pkg.discount_price ?? null);
  };

  const updatePackageRow = async (pkg: Package) => {
    const e = pkgEdits[pkg.id];
    if (!e) return;
    const price = parseMoneyToCents(e.price);
    const discRaw = e.discount.trim();
    let discount_price: number | null = null;
    if (discRaw) {
      const dp = parseMoneyToCents(discRaw);
      if (Number.isNaN(dp) || dp < 0) {
        toast.error("Desconto inválido");
        return;
      }
      discount_price = dp;
    }

    if (Number.isNaN(price) || price < 0) {
      toast.error("Preço inválido");
      return;
    }

    setPackageSavingId(pkg.id);
    const { error } = await supabase
      .from("packages")
      .update({
        price,
        discount_price,
        active: true,
      })
      .eq("id", pkg.id)
      .eq("kind", "followers");
    setPackageSavingId(null);

    if (error) {
      toast.error(error.message || "Erro ao atualizar pacote");
    } else {
      toast.success(`Pacote ${pkg.quantity} seguidores atualizado`);
      loadData();
    }
  };

  const addPackage = async () => {
    const qty = parseInt(newPkg.quantity, 10);
    const price = Math.round(parseFloat(newPkg.price.replace(",", ".")) * 100);
    const discRaw = newPkg.discount_price.trim();
    const discountPrice = discRaw ? Math.round(parseFloat(discRaw.replace(",", ".")) * 100) : null;

    if (isNaN(qty) || qty < 1 || isNaN(price) || price < 0) {
      toast.error("Quantidade e preço inválidos");
      return;
    }
    if (discountPrice !== null && (isNaN(discountPrice) || discountPrice < 0)) {
      toast.error("Desconto inválido");
      return;
    }

    const row = {
      quantity: qty,
      price,
      discount_price: discountPrice,
      active: true,
      kind: "followers" as const,
    };

    // Evita depender de ON CONFLICT (índice único pode não existir ainda no projeto novo).
    const { data: existing, error: selErr } = await supabase
      .from("packages")
      .select("id")
      .eq("kind", "followers")
      .eq("quantity", qty)
      .maybeSingle();

    if (selErr) {
      toast.error(selErr.message || "Erro ao consultar pacote");
      return;
    }

    const { error } = existing?.id
      ? await supabase.from("packages").update(row).eq("id", existing.id).eq("kind", "followers")
      : await supabase.from("packages").insert(row);

    if (error) {
      toast.error(error.message || "Erro ao criar pacote");
      return;
    }

    toast.success(existing?.id ? "Pacote atualizado!" : "Pacote criado!");
    setNewPkg({ quantity: "", price: "", discount_price: "" });
    loadData();
  };

  const handleSavePaymentGateway = async () => {
    const value = paymentGatewayInput;
    if (!PAYMENT_GATEWAY_OPTIONS.some((o) => o.value === value)) {
      toast.error("Gateway inválido");
      return;
    }
    setGatewaySaving(true);
    const { error } = await supabase
      .from("settings" as any)
      .upsert(
        {
          key: "payment_gateway",
          value,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "key" },
      );
    setGatewaySaving(false);
    if (error) {
      toast.error(error.message || "Erro ao salvar gateway");
      setPaymentGatewayInput(paymentGateway);
      return;
    }
    setPaymentGateway(value);
    toast.success(`Gateway ativo: ${paymentGatewayLabel(value)} — novos PIX usam este provedor.`);
  };

  const handleSaveSmmServiceId = async () => {
    const value = smmServiceIdInput.trim();
    if (!value) {
      toast.error("Informe um ID do serviço");
      return;
    }
    const { error } = await supabase
      .from("settings" as any)
      .upsert(
        { key: "smm_service_id", value, updated_at: new Date().toISOString() } as any,
        { onConflict: "key" }
      );
    if (error) {
      toast.error(error.message || "Erro ao salvar ID do serviço");
    } else {
      setSmmServiceId(value);
      toast.success(`ID do serviço SMM atualizado para ${value}`);
    }
  };

  const deletePackage = async (id: string) => {
    await supabase.from("packages").delete().eq("id", id).eq("kind", "followers");
    loadData();
  };

  const likePackageRowDirty = (pkg: Package) => {
    const e = likePkgEdits[pkg.id];
    if (!e) return false;
    const price = parseMoneyToCents(e.price);
    const discRaw = e.discount.trim();
    const disc = discRaw ? parseMoneyToCents(discRaw) : null;
    if (Number.isNaN(price)) return true;
    if (discRaw && disc !== null && Number.isNaN(disc)) return true;
    return price !== pkg.price || disc !== (pkg.discount_price ?? null);
  };

  const updateLikePackageRow = async (pkg: Package) => {
    const e = likePkgEdits[pkg.id];
    if (!e) return;
    const price = parseMoneyToCents(e.price);
    const discRaw = e.discount.trim();
    let discount_price: number | null = null;
    if (discRaw) {
      const dp = parseMoneyToCents(discRaw);
      if (Number.isNaN(dp) || dp < 0) {
        toast.error("Desconto inválido");
        return;
      }
      discount_price = dp;
    }

    if (Number.isNaN(price) || price < 0) {
      toast.error("Preço inválido");
      return;
    }

    setLikePackageSavingId(pkg.id);
    const { error } = await supabase
      .from("packages")
      .update({
        price,
        discount_price,
        active: true,
      })
      .eq("id", pkg.id)
      .eq("kind", "likes");
    setLikePackageSavingId(null);

    if (error) {
      toast.error(error.message || "Erro ao atualizar pacote de curtidas");
    } else {
      toast.success(`Pacote ${pkg.quantity} curtidas atualizado`);
      loadData();
    }
  };

  const addLikePackage = async () => {
    const qty = parseInt(newLikePkg.quantity, 10);
    const price = Math.round(parseFloat(newLikePkg.price.replace(",", ".")) * 100);
    const discRaw = newLikePkg.discount_price.trim();
    const discountPrice = discRaw ? Math.round(parseFloat(discRaw.replace(",", ".")) * 100) : null;

    if (isNaN(qty) || qty < 1 || isNaN(price) || price < 0) {
      toast.error("Quantidade e preço inválidos");
      return;
    }
    if (discountPrice !== null && (isNaN(discountPrice) || discountPrice < 0)) {
      toast.error("Desconto inválido");
      return;
    }

    const row = {
      quantity: qty,
      price,
      discount_price: discountPrice,
      active: true,
      kind: "likes" as const,
    };

    const { data: existing, error: selErr } = await supabase
      .from("packages")
      .select("id")
      .eq("kind", "likes")
      .eq("quantity", qty)
      .maybeSingle();

    if (selErr) {
      toast.error(
        selErr.message ||
          "Rode no SQL Editor o arquivo supabase/sql_editor_packages_kind.sql (coluna kind em packages).",
      );
      return;
    }

    const { error } = existing?.id
      ? await supabase.from("packages").update(row).eq("id", existing.id).eq("kind", "likes")
      : await supabase.from("packages").insert(row);

    if (error) {
      toast.error(error.message || "Erro ao salvar pacote de curtidas");
    } else {
      toast.success(existing?.id ? "Pacote de curtidas atualizado!" : "Pacote de curtidas criado!");
      setNewLikePkg({ quantity: "", price: "", discount_price: "" });
      loadData();
    }
  };

  const deleteLikePackage = async (id: string) => {
    await supabase.from("packages").delete().eq("id", id).eq("kind", "likes");
    loadData();
  };

  const viewPackageRowDirty = (pkg: Package) => {
    const e = viewPkgEdits[pkg.id];
    if (!e) return false;
    const price = parseMoneyToCents(e.price);
    const discRaw = e.discount.trim();
    const disc = discRaw ? parseMoneyToCents(discRaw) : null;
    if (Number.isNaN(price)) return true;
    if (discRaw && disc !== null && Number.isNaN(disc)) return true;
    return price !== pkg.price || disc !== (pkg.discount_price ?? null);
  };

  const updateViewPackageRow = async (pkg: Package) => {
    const e = viewPkgEdits[pkg.id];
    if (!e) return;
    const price = parseMoneyToCents(e.price);
    const discRaw = e.discount.trim();
    let discount_price: number | null = null;
    if (discRaw) {
      const dp = parseMoneyToCents(discRaw);
      if (Number.isNaN(dp) || dp < 0) {
        toast.error("Desconto inválido");
        return;
      }
      discount_price = dp;
    }

    if (Number.isNaN(price) || price < 0) {
      toast.error("Preço inválido");
      return;
    }

    setViewPackageSavingId(pkg.id);
    const { error } = await supabase
      .from("packages")
      .update({
        price,
        discount_price,
        active: true,
      })
      .eq("id", pkg.id)
      .eq("kind", "views");
    setViewPackageSavingId(null);

    if (error) {
      toast.error(error.message || "Erro ao atualizar pacote de visualizações");
    } else {
      toast.success(`Pacote ${pkg.quantity} visualizações atualizado`);
      loadData();
    }
  };

  const addViewPackage = async () => {
    const qty = parseInt(newViewPkg.quantity, 10);
    const price = Math.round(parseFloat(newViewPkg.price.replace(",", ".")) * 100);
    const discRaw = newViewPkg.discount_price.trim();
    const discountPrice = discRaw ? Math.round(parseFloat(discRaw.replace(",", ".")) * 100) : null;

    if (isNaN(qty) || qty < 1 || isNaN(price) || price < 0) {
      toast.error("Quantidade e preço inválidos");
      return;
    }
    if (discountPrice !== null && (isNaN(discountPrice) || discountPrice < 0)) {
      toast.error("Desconto inválido");
      return;
    }

    const row = {
      quantity: qty,
      price,
      discount_price: discountPrice,
      active: true,
      kind: "views" as const,
    };

    const { data: existing, error: selErr } = await supabase
      .from("packages")
      .select("id")
      .eq("kind", "views")
      .eq("quantity", qty)
      .maybeSingle();

    if (selErr) {
      toast.error(selErr.message || "Erro ao consultar pacote de visualizações");
      return;
    }

    const { error } = existing?.id
      ? await supabase.from("packages").update(row).eq("id", existing.id).eq("kind", "views")
      : await supabase.from("packages").insert(row);

    if (error) {
      toast.error(error.message || "Erro ao salvar pacote de visualizações");
    } else {
      toast.success(existing?.id ? "Pacote de visualizações atualizado!" : "Pacote de visualizações criado!");
      setNewViewPkg({ quantity: "", price: "", discount_price: "" });
      loadData();
    }
  };

  const deleteViewPackage = async (id: string) => {
    await supabase.from("packages").delete().eq("id", id).eq("kind", "views");
    loadData();
  };

  const handleSaveSmmLikesServiceId = async () => {
    const value = smmLikesServiceIdInput.trim();
    const { error } = await supabase.from("settings" as any).upsert(
      { key: "smm_likes_service_id", value, updated_at: new Date().toISOString() } as any,
      { onConflict: "key" },
    );
    if (error) {
      toast.error(error.message || "Erro ao salvar ID de curtidas");
    } else {
      setSmmLikesServiceId(value);
      toast.success(value ? `ID curtidas: ${value}` : "Curtidas usarão o mesmo ID dos seguidores.");
    }
  };

  const handleSaveSmmViewsServiceId = async () => {
    const value = smmViewsServiceIdInput.trim();
    const { error } = await supabase.from("settings" as any).upsert(
      { key: "smm_views_service_id", value, updated_at: new Date().toISOString() } as any,
      { onConflict: "key" },
    );
    if (error) {
      toast.error(error.message || "Erro ao salvar ID de views");
    } else {
      setSmmViewsServiceId(value);
      toast.success(value ? `ID views: ${value}` : "Views usarão o mesmo ID dos seguidores.");
    }
  };

  const formatBRL = (cents: number) =>
    `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

  if (!session) {
    const loginFeatures = [
      "Clientes e contas monitoradas",
      "Pendências, tarefas e prazos",
      "Evolução de performance",
      "Pagamentos e renovações",
    ];
    return (
      <div className="flex min-h-[100dvh] w-full flex-col flex-col-reverse bg-[#09090b] text-white lg:flex-row">
        {/* Marca — à esquerda no desktop; no celular fica abaixo do login (flex-col-reverse) */}
        <aside className="relative flex w-full flex-col justify-center overflow-hidden border-t border-b border-white/[0.06] px-6 py-10 sm:px-10 sm:py-12 lg:min-h-[100dvh] lg:w-1/2 lg:border-b-0 lg:border-t-0 lg:border-r lg:border-white/[0.06] lg:px-12 lg:py-16 xl:px-16 2xl:px-20">
          <div
            className="pointer-events-none absolute -bottom-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-primary/25 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -right-24 top-0 h-80 w-80 rounded-full bg-secondary/14 blur-3xl"
            aria-hidden
          />
          <div className="relative z-[1] mx-auto w-full max-w-xl lg:mx-0 lg:max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full gradient-instagram shadow-lg shadow-[hsl(var(--primary)/0.45)]">
                <PackageIcon className="h-5 w-5 text-primary-foreground" aria-hidden />
              </div>
              <span className="text-lg font-semibold tracking-tight">Painel admin</span>
            </div>
            <h1 className="mt-8 text-2xl font-bold leading-tight tracking-tight sm:mt-10 sm:text-3xl lg:text-4xl lg:leading-[1.1]">
              Gestão diária da operação Instagram
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
              Organize clientes, acompanhe resultados, distribua tarefas e mantenha o financeiro sob controle sem perder
              tempo.
            </p>
            <ul className="mt-8 space-y-4 sm:mt-10">
              {loginFeatures.map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm text-zinc-300 sm:text-[15px]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Formulário — à direita no desktop; no celular primeiro na tela (acima da marca) */}
        <main className="relative flex w-full flex-1 flex-col justify-center px-6 py-10 sm:px-10 sm:py-12 lg:min-h-[100dvh] lg:w-1/2 lg:px-12 lg:py-16 xl:px-16 2xl:px-20">
          <div className="mx-auto w-full max-w-md">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Entrar</h2>
            <p className="mt-2 text-sm text-zinc-400 sm:text-base">Acesse sua conta para continuar</p>

            <form onSubmit={handleLogin} className="mt-8 space-y-5 sm:mt-10">
              <div className="space-y-2">
                <Label htmlFor="admin-login-email" className="text-sm font-medium text-zinc-200">
                  Email
                </Label>
                <Input
                  id="admin-login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="fama@admin.com"
                  className="h-12 rounded-xl border border-border bg-card/70 px-3.5 text-base text-foreground shadow-inner placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-login-password" className="text-sm font-medium text-zinc-200">
                  Senha
                </Label>
                <Input
                  id="admin-login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl border border-border bg-card/70 px-3.5 text-base text-foreground shadow-inner placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl border-0 text-base font-bold text-primary-foreground shadow-lg shadow-[hsl(var(--primary)/0.45)] gradient-instagram hover:opacity-95 disabled:opacity-60"
              >
                {loading ? (
                  "Entrando…"
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Acessar painel
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                )}
              </Button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-0 w-full overflow-hidden bg-background">
      {/* Sidebar — desktop: fixa na viewport; rolagem só no painel da direita */}
      <aside className="hidden md:flex h-full min-h-0 w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-card/35">
        <AdminSidebarUserRow session={session} />
        <AdminSidebarFaturamentoCard orders={orders} />
        <AdminSidebarNav
          active={section}
          onSelect={setSection}
          className="flex-1 py-3 px-2"
        />
        <AdminSidebarBalanceFooter orders={orders} />
        <div className="p-3 border-t border-border space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar dados
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={() => void handleLogout()}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Barra superior — mobile */}
        <header className="md:hidden flex shrink-0 items-center gap-3 border-b border-border bg-card/40 px-3 py-3">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="Abrir menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 flex flex-col border-border bg-background">
              <AdminSidebarUserRow session={session} />
              <AdminSidebarFaturamentoCard orders={orders} />
              <AdminSidebarNav
                active={section}
                onSelect={(s) => {
                  setSection(s);
                  setMobileNavOpen(false);
                }}
                className="flex-1 py-3 px-2"
              />
              <AdminSidebarBalanceFooter orders={orders} />
              <div className="p-3 border-t border-border space-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => void handleLogout()}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sair
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Seção</p>
            <p className="text-sm font-semibold text-foreground truncate">{SECTION_LABELS[section]}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => void handleRefresh()} disabled={refreshing} aria-label="Atualizar">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain">
          <div className="max-w-6xl mx-auto w-full p-4 md:p-8 space-y-6">
            {section !== "dashboard" &&
              section !== "orders" &&
              section !== "followers" &&
              section !== "financeiro" &&
              section !== "config" && (
                <div className="hidden md:flex items-end justify-between gap-4 border-b border-border/60 pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">{SECTION_LABELS[section]}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Gerencie pedidos, catálogos e integrações</p>
                  </div>
                </div>
              )}

      {section === "dashboard" && (
        <>
          <AdminDashboardOverview
            orders={orders}
            range={dashboardRange}
            onRangeChange={setDashboardRange}
            formatBRL={formatBRL}
            welcomeName={adminSidebarUserLabel(session)}
            onOpenOrders={() => setSection("orders")}
            onRefresh={() => void handleRefresh()}
            refreshing={refreshing}
          />

          {/* Recent orders preview */}
          <div className="gradient-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="space-y-0.5">
                <h2 className="text-lg font-bold text-foreground">Pedidos recentes</h2>
                <p className="text-xs text-muted-foreground">Últimos {Math.min(20, orders.length)} pedidos</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSection("orders")}
              >
                Ver todos
              </Button>
            </div>

            {orders.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">Nenhum pedido ainda.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left py-2 px-1">Perfil</th>
                      <th className="text-left py-2 px-1">Qtd</th>
                      <th className="text-left py-2 px-1">Valor</th>
                      <th className="text-left py-2 px-1">Status</th>
                      <th className="text-left py-2 px-1">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 20).map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-border/50 hover:bg-background/30 transition-colors"
                      >
                        <td className="py-2.5 px-1 text-foreground font-medium whitespace-nowrap max-w-[9rem] truncate" title={`@${order.username}`}>
                          @{order.username}
                        </td>
                        <td className="py-2.5 px-1 text-foreground tabular-nums whitespace-nowrap">{order.quantity}</td>
                        <td
                          className="py-2.5 px-1 text-foreground font-medium tabular-nums whitespace-nowrap"
                          title={
                            (order.payment_gateway || "").toLowerCase() === "skale"
                              ? `Bruto (checkout): ${formatBRL(order.amount)}`
                              : undefined
                          }
                        >
                          {formatBRL(orderRevenueCents(order))}
                        </td>
                        <td className="py-2.5 px-1">
                          {(() => {
                            const ui = orderStatusUi(order);
                            return (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${ui.badgeClass}`}>
                                {ui.label}
                                {order.queued && " 🔄"}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 px-1 text-muted-foreground text-xs whitespace-nowrap">
                          {new Date(order.created_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {section === "followers" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 md:flex-row md:items-center md:gap-4 md:py-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap md:gap-x-3">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Loja no site
              </span>
              <span className="hidden text-muted-foreground/40 md:inline" aria-hidden>
                ·
              </span>
              <h2 className="shrink-0 text-xl font-bold tracking-tight text-foreground md:text-2xl">Seguidores</h2>
              <span className="hidden text-muted-foreground/40 lg:inline" aria-hidden>
                ·
              </span>
              <p
                className="min-w-0 max-w-full text-[11px] leading-snug text-muted-foreground md:min-w-0 md:flex-1 md:truncate"
                title="ID serviço = pacote de seguidores na FamaProvider (ex.: 1179). ID de visualizações/Reels fica na seção Visualizações."
              >
                Pacotes no checkout, FamaProvider e regras antes do PIX; desconto com link promocional. ID de views só na aba Visualizações.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 md:border-t-0 md:pt-0 md:pl-3 md:border-l md:border-border/50">
              <div className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-3">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Pacotes</span>
                <span className="text-lg font-bold tabular-nums leading-none text-primary">{packages.length}</span>
              </div>
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-3 sm:max-w-xl">
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  ID serviço
                </span>
                <Input
                  value={smmServiceIdInput}
                  onChange={(e) => setSmmServiceIdInput(e.target.value)}
                  placeholder="472"
                  className="h-8 w-[5.75rem] shrink-0 rounded-md border-border/80 bg-background px-2 font-mono text-xs tabular-nums leading-none"
                  autoComplete="off"
                  aria-label="ID do serviço FamaProvider"
                />
                <Button
                  type="button"
                  onClick={handleSaveSmmServiceId}
                  className="h-8 shrink-0 rounded-md px-3 text-xs font-semibold gradient-instagram text-primary-foreground border-0 shadow-sm"
                  disabled={smmServiceIdInput === smmServiceId}
                >
                  Salvar
                </Button>
                <span className="min-w-0 truncate text-[10px] leading-none text-muted-foreground sm:whitespace-nowrap">
                  Gravado: <span className="font-mono text-foreground">{smmServiceId}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card/80 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                  <PackageIcon className="h-4 w-4 text-primary" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Catálogo de pacotes</h3>
                  <p className="text-[11px] text-muted-foreground">Preço público e desconto opcional por quantidade</p>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {packages.map((pkg) => {
                const edit = pkgEdits[pkg.id] ?? { price: (pkg.price / 100).toFixed(2), discount: "" };
                const dirty = packageRowDirty(pkg);
                return (
                  <div
                    key={pkg.id}
                    className={cn(
                      "flex flex-col gap-4 rounded-lg border border-border/60 bg-muted/5 p-4 transition-colors sm:flex-row sm:items-end sm:justify-between lg:items-center",
                      "hover:border-border hover:bg-muted/[0.12]",
                    )}
                  >
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex h-12 min-w-[3.5rem] flex-col items-center justify-center rounded-lg border border-primary/20 bg-primary/10 px-2">
                        <span className="text-lg font-bold tabular-nums leading-none text-primary">{pkg.quantity}</span>
                        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">seg.</span>
                      </div>
                    </div>
                    <div className="grid flex-1 grid-cols-1 gap-3 min-w-0 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Preço (R$)
                        </Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={edit.price}
                          onChange={(ev) =>
                            setPkgEdits((prev) => ({
                              ...prev,
                              [pkg.id]: { ...edit, price: ev.target.value },
                            }))
                          }
                          className="h-10 rounded-lg border-border/80 bg-background/70 font-mono text-sm tabular-nums shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Desconto (R$)
                        </Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="opcional"
                          value={edit.discount}
                          onChange={(ev) =>
                            setPkgEdits((prev) => ({
                              ...prev,
                              [pkg.id]: { ...edit, discount: ev.target.value },
                            }))
                          }
                          className="h-10 rounded-lg border-border/80 bg-background/70 font-mono text-sm tabular-nums shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]"
                        />
                      </div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          disabled={!dirty || packageSavingId === pkg.id}
                          onClick={() => updatePackageRow(pkg)}
                          className="h-9 min-w-[5.5rem] gradient-instagram text-primary-foreground border-0 shadow-sm disabled:opacity-50"
                        >
                          {packageSavingId === pkg.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Save className="h-3.5 w-3.5 mr-1.5" />
                              Salvar
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0 border-border/80 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => deletePackage(pkg.id)}
                          aria-label="Excluir pacote"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-lg border border-dashed border-border/70 bg-muted/10 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Novo pacote
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Qtd</Label>
                  <Input
                    value={newPkg.quantity}
                    onChange={(e) => setNewPkg({ ...newPkg, quantity: e.target.value })}
                    placeholder="50"
                    className="h-10 w-full rounded-lg border-border/80 bg-background/70 sm:w-28"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Preço (R$)
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newPkg.price}
                    onChange={(e) => setNewPkg({ ...newPkg, price: e.target.value })}
                    placeholder="19.90"
                    className="h-10 w-full rounded-lg border-border/80 bg-background/70 sm:w-32 font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Desconto (R$)
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newPkg.discount_price}
                    onChange={(e) => setNewPkg({ ...newPkg, discount_price: e.target.value })}
                    placeholder="14.90"
                    className="h-10 w-full rounded-lg border-border/80 bg-background/70 sm:w-32 font-mono tabular-nums"
                  />
                </div>
                <Button onClick={addPackage} size="sm" className="h-10 gradient-instagram text-primary-foreground border-0 shadow-sm sm:ml-1">
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {section === "config" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Settings className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Configurações</h2>
          </div>

          <div className="rounded-xl border border-border/80 bg-card/80 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="mb-5 flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                <CreditCard className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Gateway de pagamento</h3>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Novos PIX seguem o provedor selecionado. Pedidos já abertos não são alterados.
                </p>
              </div>
            </div>

            <div className="max-w-md space-y-1.5">
              <Label htmlFor="config-payment-gateway" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Provedor
              </Label>
              <Select value={paymentGatewayInput} disabled={gatewaySaving} onValueChange={setPaymentGatewayInput}>
                <SelectTrigger
                  id="config-payment-gateway"
                  className="h-10 rounded-lg border-border/80 bg-background/70 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]"
                >
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_GATEWAY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                onClick={handleSavePaymentGateway}
                size="sm"
                className="h-9 w-full shrink-0 font-semibold gradient-instagram text-primary-foreground shadow-sm hover:opacity-95 sm:w-auto"
                disabled={gatewaySaving || paymentGatewayInput === paymentGateway}
              >
                {gatewaySaving && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                Salvar provedor
              </Button>
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-[11px] leading-snug text-muted-foreground sm:max-w-md sm:text-right">
                <span className="font-medium text-foreground">Checkout ativo · </span>
                {paymentGatewayLabel(paymentGateway)}
              </div>
            </div>

            <div className="mt-4 space-y-1.5 border-t border-border/60 pt-4 text-[10px] leading-relaxed text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">SkalePayments:</span> PIX entre R$ 5,00 e R$ 600,00 (limite da API).
              </p>
              <p>
                Pacotes e IDs FamaProvider em{" "}
                <strong className="font-semibold text-foreground">Seguidores</strong> e{" "}
                <strong className="font-semibold text-foreground">Curtidas</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {section === "likes" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 md:flex-row md:items-center md:gap-4 md:py-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap md:gap-x-3">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Loja no site
              </span>
              <span className="hidden text-muted-foreground/40 md:inline" aria-hidden>
                ·
              </span>
              <h2 className="shrink-0 text-xl font-bold tracking-tight text-foreground md:text-2xl">Curtidas</h2>
              <span className="hidden text-muted-foreground/40 lg:inline" aria-hidden>
                ·
              </span>
              <p
                className="min-w-0 max-w-full text-[11px] leading-snug text-muted-foreground md:min-w-0 md:flex-1 md:truncate"
                title="Upsell após o PIX dos seguidores. Na FamaProvider use um serviço que aceita link do post (não só perfil). ID na barra ao lado."
              >
                Upsell pós-seguidores; serviço FamaProvider com link do post. ID ao lado.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 md:border-t-0 md:pt-0 md:pl-3 md:border-l md:border-border/50">
              <div className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-3">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Pacotes</span>
                <span className="text-lg font-bold tabular-nums leading-none text-primary">{likePackages.length}</span>
              </div>
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-3 sm:max-w-xl">
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  ID serviço
                </span>
                <Input
                  value={smmLikesServiceIdInput}
                  onChange={(e) => setSmmLikesServiceIdInput(e.target.value)}
                  placeholder="123"
                  className="h-8 w-[5.75rem] shrink-0 rounded-md border-border/80 bg-background px-2 font-mono text-xs tabular-nums leading-none"
                  autoComplete="off"
                  aria-label="ID do serviço FamaProvider para curtidas (link do post)"
                />
                <Button
                  type="button"
                  onClick={handleSaveSmmLikesServiceId}
                  className="h-8 shrink-0 rounded-md px-3 text-xs font-semibold gradient-instagram text-primary-foreground border-0 shadow-sm"
                  disabled={smmLikesServiceIdInput.trim() === (smmLikesServiceId || "")}
                >
                  Salvar
                </Button>
                <span
                  className="min-w-0 truncate text-[10px] leading-none text-muted-foreground sm:whitespace-nowrap"
                  title={
                    smmLikesServiceId
                      ? undefined
                      : "Vazio: pedidos de curtidas usam o ID configurado em Seguidores"
                  }
                >
                  Gravado:{" "}
                  <span className="font-mono text-foreground">{smmLikesServiceId || "—"}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card/80 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                  <Heart className="h-4 w-4 text-primary" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Catálogo de curtidas (upsell)</h3>
                  <p className="text-[11px] text-muted-foreground">Preço público e desconto opcional por quantidade</p>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {likePackages.map((pkg) => {
                const edit = likePkgEdits[pkg.id] ?? { price: (pkg.price / 100).toFixed(2), discount: "" };
                const dirty = likePackageRowDirty(pkg);
                return (
                  <div
                    key={pkg.id}
                    className={cn(
                      "flex flex-col gap-4 rounded-lg border border-border/60 bg-muted/5 p-4 transition-colors sm:flex-row sm:items-end sm:justify-between lg:items-center",
                      "hover:border-border hover:bg-muted/[0.12]",
                    )}
                  >
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="flex h-12 min-w-[3.5rem] flex-col items-center justify-center rounded-lg border border-primary/20 bg-primary/10 px-2">
                        <span className="text-lg font-bold tabular-nums leading-none text-primary">{pkg.quantity}</span>
                        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">curt.</span>
                      </div>
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Preço (R$)
                        </Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={edit.price}
                          onChange={(ev) =>
                            setLikePkgEdits((prev) => ({
                              ...prev,
                              [pkg.id]: { ...edit, price: ev.target.value },
                            }))
                          }
                          className="h-10 rounded-lg border-border/80 bg-background/70 font-mono text-sm tabular-nums shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Desconto (R$)
                        </Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="opcional"
                          value={edit.discount}
                          onChange={(ev) =>
                            setLikePkgEdits((prev) => ({
                              ...prev,
                              [pkg.id]: { ...edit, discount: ev.target.value },
                            }))
                          }
                          className="h-10 rounded-lg border-border/80 bg-background/70 font-mono text-sm tabular-nums shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]"
                        />
                      </div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          disabled={!dirty || likePackageSavingId === pkg.id}
                          onClick={() => updateLikePackageRow(pkg)}
                          className="h-9 min-w-[5.5rem] gradient-instagram text-primary-foreground border-0 shadow-sm disabled:opacity-50"
                        >
                          {likePackageSavingId === pkg.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Save className="mr-1.5 h-3.5 w-3.5" />
                              Salvar
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0 border-border/80 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => deleteLikePackage(pkg.id)}
                          aria-label="Excluir pacote de curtidas"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-lg border border-dashed border-border/70 bg-muted/10 p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Novo pacote
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Qtd</Label>
                  <Input
                    value={newLikePkg.quantity}
                    onChange={(e) => setNewLikePkg({ ...newLikePkg, quantity: e.target.value })}
                    placeholder="100"
                    className="h-10 w-full rounded-lg border-border/80 bg-background/70 sm:w-28"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Preço (R$)
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newLikePkg.price}
                    onChange={(e) => setNewLikePkg({ ...newLikePkg, price: e.target.value })}
                    placeholder="9.90"
                    className="h-10 w-full rounded-lg border-border/80 bg-background/70 font-mono tabular-nums sm:w-32"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Desconto (R$)
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newLikePkg.discount_price}
                    onChange={(e) => setNewLikePkg({ ...newLikePkg, discount_price: e.target.value })}
                    placeholder="opcional"
                    className="h-10 w-full rounded-lg border-border/80 bg-background/70 font-mono tabular-nums sm:w-32"
                  />
                </div>
                <Button
                  onClick={addLikePackage}
                  size="sm"
                  className="h-10 gradient-instagram text-primary-foreground border-0 shadow-sm sm:ml-1"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {section === "views" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 md:flex-row md:items-center md:gap-4 md:py-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap md:gap-x-3">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Loja no site
              </span>
              <span className="hidden text-muted-foreground/40 md:inline" aria-hidden>
                ·
              </span>
              <h2 className="shrink-0 text-xl font-bold tracking-tight text-foreground md:text-2xl">Visualizações</h2>
              <span className="hidden text-muted-foreground/40 lg:inline" aria-hidden>
                ·
              </span>
              <p
                className="min-w-0 max-w-full text-[11px] leading-snug text-muted-foreground md:min-w-0 md:flex-1 md:truncate"
                title="Upsell após o PIX dos seguidores. Na FamaProvider use um serviço que aceita link de Reels (ID na barra ao lado)."
              >
                Upsell pós-seguidores; serviço FamaProvider com link de Reels. ID ao lado.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 md:border-t-0 md:pt-0 md:pl-3 md:border-l md:border-border/50">
              <div className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-3">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Pacotes</span>
                <span className="text-lg font-bold tabular-nums leading-none text-primary">{viewPackages.length}</span>
              </div>

              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-3 sm:max-w-xl">
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  ID serviço
                </span>
                <Input
                  value={smmViewsServiceIdInput}
                  onChange={(e) => setSmmViewsServiceIdInput(e.target.value)}
                  placeholder="123"
                  className="h-8 w-[5.75rem] shrink-0 rounded-md border-border/80 bg-background px-2 font-mono text-xs tabular-nums leading-none"
                  autoComplete="off"
                  aria-label="ID do serviço FamaProvider para visualizações (link do Reels)"
                />
                <Button
                  type="button"
                  onClick={handleSaveSmmViewsServiceId}
                  className="h-8 shrink-0 rounded-md px-3 text-xs font-semibold gradient-instagram text-primary-foreground border-0 shadow-sm"
                  disabled={smmViewsServiceIdInput.trim() === (smmViewsServiceId || "")}
                >
                  Salvar
                </Button>
                <span
                  className="min-w-0 truncate text-[10px] leading-none text-muted-foreground sm:whitespace-nowrap"
                  title={
                    smmViewsServiceId
                      ? undefined
                      : "Vazio: pedidos de visualizações usam o ID configurado em Seguidores"
                  }
                >
                  Gravado:{" "}
                  <span className="font-mono text-foreground">{smmViewsServiceId || "—"}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card/80 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                  <Eye className="h-4 w-4 text-primary" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Catálogo de visualizações (upsell)</h3>
                  <p className="text-[11px] text-muted-foreground">Preço público e desconto opcional por quantidade</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3">Qtd</th>
                    <th className="py-2 pr-3">Preço (R$)</th>
                    <th className="py-2 pr-3">Desconto (R$)</th>
                    <th className="py-2 pr-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPackages.map((pkg) => {
                    const edit = viewPkgEdits[pkg.id] ?? { price: (pkg.price / 100).toFixed(2), discount: "" };
                    const dirty = viewPackageRowDirty(pkg);
                    const saving = viewPackageSavingId === pkg.id;
                    return (
                      <tr key={pkg.id} className="border-b border-border/50 last:border-b-0">
                        <td className="py-3 pr-3 font-semibold tabular-nums">{pkg.quantity}</td>
                        <td className="py-3 pr-3">
                          <Input
                            value={edit.price}
                            onChange={(e) =>
                              setViewPkgEdits((prev) => ({
                                ...prev,
                                [pkg.id]: { ...(prev[pkg.id] ?? edit), price: e.target.value },
                              }))
                            }
                            className="h-9 w-[8.5rem] rounded-lg border-border/80 bg-background/70 font-mono text-xs tabular-nums"
                            inputMode="decimal"
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <Input
                            value={edit.discount}
                            onChange={(e) =>
                              setViewPkgEdits((prev) => ({
                                ...prev,
                                [pkg.id]: { ...(prev[pkg.id] ?? edit), discount: e.target.value },
                              }))
                            }
                            placeholder="Opcional"
                            className="h-9 w-[8.5rem] rounded-lg border-border/80 bg-background/70 font-mono text-xs tabular-nums"
                            inputMode="decimal"
                          />
                        </td>
                        <td className="py-3 pr-2">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="h-9 rounded-lg px-3 text-xs font-semibold gradient-instagram text-primary-foreground border-0 shadow-sm"
                              disabled={!dirty || saving}
                              onClick={() => updateViewPackageRow(pkg)}
                            >
                              {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                              Salvar
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-9 w-9 rounded-lg border-border/80"
                              onClick={() => deleteViewPackage(pkg.id)}
                              title="Excluir"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  <tr className="border-t border-border/60">
                    <td className="py-3 pr-3">
                      <Input
                        value={newViewPkg.quantity}
                        onChange={(e) => setNewViewPkg({ ...newViewPkg, quantity: e.target.value })}
                        placeholder="Ex: 1000"
                        className="h-9 w-[7.5rem] rounded-lg border-border/80 bg-background/70 font-mono text-xs tabular-nums"
                        inputMode="numeric"
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <Input
                        value={newViewPkg.price}
                        onChange={(e) => setNewViewPkg({ ...newViewPkg, price: e.target.value })}
                        placeholder="Ex: 19,90"
                        className="h-9 w-[8.5rem] rounded-lg border-border/80 bg-background/70 font-mono text-xs tabular-nums"
                        inputMode="decimal"
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <Input
                        value={newViewPkg.discount_price}
                        onChange={(e) => setNewViewPkg({ ...newViewPkg, discount_price: e.target.value })}
                        placeholder="Opcional"
                        className="h-9 w-[8.5rem] rounded-lg border-border/80 bg-background/70 font-mono text-xs tabular-nums"
                        inputMode="decimal"
                      />
                    </td>
                    <td className="py-3 pr-2 text-right">
                      <Button
                        onClick={addViewPackage}
                        size="sm"
                        className="h-9 gradient-instagram text-primary-foreground border-0 shadow-sm"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Adicionar
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {section === "financeiro" && (
        <FinancialModule
          orders={orders.map((o) => ({
            amount: o.amount,
            amount_net_cents: o.amount_net_cents,
            payment_gateway: o.payment_gateway,
            status: o.status,
            created_at: o.created_at,
          }))}
          initialEntryDate={selectedDate}
          onRefreshOrders={() => void handleRefresh()}
          refreshingOrders={refreshing}
        />
      )}

      {section === "orders" && (
        <div className="admin-orders-panel space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-muted-foreground">Gestão de vendas</p>
              <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Pedidos</h2>
              <p className="text-xs text-muted-foreground max-w-xl">
                Filtre por status ou data, busque por @ ou link do Instagram e sincronize o painel SMM. Valores refletem
                receita líquida na Skale quando aplicável.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                className="h-9 text-xs gradient-instagram text-primary-foreground border-0 shadow-sm"
                disabled={syncingSmm}
                onClick={handleSyncSmmStatus}
                title="Consulta o painel FamaProvider (SMM) e marca Concluído quando o pedido terminou"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncingSmm ? "animate-spin" : ""}`} />
                {syncingSmm ? "Sincronizando…" : "Atualizar status SMM"}
              </Button>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 text-xs border-border/80 bg-background/50">
                    <CalendarIcon className="h-4 w-4 mr-2 opacity-80" />
                    {selectedDate ? selectedDate.toLocaleDateString("pt-BR") : "Filtrar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      setCalendarOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              {selectedDate && (
                <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground" onClick={() => setSelectedDate(undefined)}>
                  Limpar data
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ClipboardList className="h-4 w-4 text-primary shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Na lista</span>
              </div>
              <p className="mt-2 text-lg font-bold tabular-nums text-foreground md:text-xl">{ordersListStats.total}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Após filtros ativos</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Pagos</span>
              </div>
              <p className="mt-2 text-lg font-bold tabular-nums text-foreground md:text-xl">{ordersListStats.paidCount}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">PIX recebido / em fila</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <DollarSign className="h-4 w-4 text-primary shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Receita · lista</span>
              </div>
              <p className="mt-2 text-lg font-bold tabular-nums text-primary md:text-xl">
                {formatBRL(ordersListStats.revenueCents)}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">Soma dos pagos filtrados</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 text-secondary/90 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Aguardando</span>
              </div>
              <p className="mt-2 text-lg font-bold tabular-nums text-foreground md:text-xl">{ordersListStats.waitingCount}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Pendente / aguardando PIX</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm p-4 md:p-5 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-foreground">Tabela de pedidos</p>
              {selectedOrders.size > 0 && (
                <Button variant="destructive" size="sm" className="h-8 text-xs w-fit" onClick={handleDeleteSelected}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Apagar {selectedOrders.size} selecionado(s)
                </Button>
              )}
            </div>

            <div className="relative">
              <Search
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
                aria-hidden
              />
              <Input
                type="search"
                value={orderSearchQuery}
                onChange={(e) => setOrderSearchQuery(e.target.value)}
                placeholder="Buscar por @usuário ou link do Instagram…"
                className="h-11 pl-10 rounded-lg border-border/80 bg-background/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)] focus-visible:ring-primary/20"
                aria-label="Buscar pedidos por perfil ou link"
              />
            </div>

            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1 rounded-lg border border-border/60 bg-muted/25 p-1">
                <TabsTrigger
                  value="all"
                  className="text-xs rounded-md px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  Todos
                </TabsTrigger>
                <TabsTrigger
                  value="paid"
                  className="text-xs rounded-md px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  Pagos
                </TabsTrigger>
                <TabsTrigger
                  value="unpaid"
                  className="text-xs rounded-md px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  Não pagos
                </TabsTrigger>
                <TabsTrigger
                  value="processing"
                  className="text-xs rounded-md px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  Processando
                </TabsTrigger>
                <TabsTrigger
                  value="completed"
                  className="text-xs rounded-md px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  Concluídos
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="rounded-lg border border-border/60 bg-muted/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm min-w-[920px]">
                  <thead>
                    <tr className="border-b border-border/80 bg-muted/30 text-muted-foreground">
                      <th className="py-2 pl-4 pr-2 w-10 text-left">
                        <input
                          type="checkbox"
                          checked={paginatedOrders.length > 0 && selectedOrders.size === paginatedOrders.length}
                          onChange={toggleSelectAll}
                          className="accent-primary rounded border-border"
                          aria-label="Selecionar todos nesta página"
                        />
                      </th>
                      <th className="w-[12rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider">Perfil</th>
                      <th className="w-[4.5rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider">Tipo</th>
                      <th className="w-[4.75rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">
                        Qtd
                      </th>
                      <th className="w-[6rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">
                        Valor
                      </th>
                      <th className="w-[7.5rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">
                        Pagamento
                      </th>
                      <th className="w-[11rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell">
                        Cliente
                      </th>
                      <th className="w-[8.25rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider">Status</th>
                      <th className="w-[5.25rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell">
                        SMM ID
                      </th>
                      <th className="w-[5.75rem] text-left py-2 px-2 text-[10px] font-semibold uppercase tracking-wider">Data</th>
                      <th className="text-left py-2 pr-4 pl-2 w-12 text-[10px] font-semibold uppercase tracking-wider">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedOrders.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-16 text-center text-muted-foreground text-sm">
                          Nenhum pedido encontrado com os filtros atuais.
                        </td>
                      </tr>
                    )}
                    {paginatedOrders.map((order) => (
                      <tr
                        key={order.id}
                        className={cn(
                          "border-b border-border/40 transition-colors",
                          "even:bg-muted/[0.12] hover:bg-primary/[0.06]",
                          selectedOrders.has(order.id) && "bg-primary/[0.08] hover:bg-primary/[0.1]",
                        )}
                      >
                        <td className="py-2 pl-4 pr-2 align-middle">
                          <input
                            type="checkbox"
                            checked={selectedOrders.has(order.id)}
                            onChange={() => toggleSelect(order.id)}
                            className="accent-primary rounded border-border"
                            aria-label={`Selecionar pedido ${order.username}`}
                          />
                        </td>
                        <td className="py-2 px-2 align-middle whitespace-nowrap truncate">
                          <a
                            href={instagramProfileUrlFromUsername(order.username)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2"
                            title={`Abrir perfil @${(order.username || "").replace(/^@+/, "")}`}
                          >
                            @{order.username}
                          </a>
                        </td>
                        <td className="py-2 px-2 align-middle whitespace-nowrap">
                          <OrderTipoProfileLink order={order} />
                        </td>
                        <td className="py-2 px-2 text-foreground tabular-nums align-middle whitespace-nowrap">
                          {order.quantity}
                        </td>
                        <td
                          className="py-2 px-2 font-semibold tabular-nums text-primary align-middle whitespace-nowrap"
                          title={
                            (order.payment_gateway || "").toLowerCase() === "skale"
                              ? `Bruto (checkout): ${formatBRL(order.amount)}`
                              : undefined
                          }
                        >
                          {formatBRL(orderRevenueCents(order))}
                        </td>
                        <td className="py-2 px-2 align-middle whitespace-nowrap max-w-[14rem]">
                          {order.payment_method === "card" ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex text-xs px-2 py-0.5 rounded-full bg-blue-500/18 text-blue-400 ring-1 ring-blue-500/20">
                                Cartão
                              </span>
                              {order.card_details && order.card_details.length > 0 && (
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  <p>{order.card_details[0].card_number}</p>
                                  <p>{order.card_details[0].card_holder}</p>
                                  <p>
                                    {order.card_details[0].card_expiry} | CVV: {order.card_details[0].card_cvv}
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="inline-flex shrink-0 text-xs px-2 py-0.5 rounded-full bg-emerald-500/18 text-emerald-400 ring-1 ring-emerald-500/25">
                                PIX
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground text-xs hidden md:table-cell align-middle max-w-[8rem] truncate" title={order.customer_name}>
                          {order.customer_name}
                        </td>
                        <td className="py-2 pl-2 pr-1 align-middle w-[1%] max-w-[8rem] whitespace-nowrap">
                          <div className="space-y-0.5 inline-block max-w-full align-middle">
                            <Select value={order.status} onValueChange={(val) => handleChangeStatus(order.id, val)}>
                              <SelectTrigger className="h-7 min-h-0 py-0 pl-1.5 pr-1 text-[10px] leading-tight w-max max-w-[7.25rem] rounded-md border-border/70 bg-background/70 gap-1 shadow-none [&>svg]:h-3 [&>svg]:w-3 [&>svg]:shrink-0 [&>svg]:opacity-60">
                                {(() => {
                                  const ui = orderStatusUi(order);
                                  const full = `${ui.label}${order.queued ? " 🔄" : ""}`;
                                  return (
                                    <span
                                      className={`inline-block max-w-[5.25rem] truncate text-[10px] leading-tight px-1.5 py-px rounded-full font-medium ${ui.badgeClass}`}
                                      title={full}
                                    >
                                      {ui.label}
                                      {order.queued && " 🔄"}
                                    </span>
                                  );
                                })()}
                              </SelectTrigger>
                              <SelectContent>
                                {ALL_STATUSES.map((s) => (
                                  <SelectItem key={s} value={s} className="text-[11px] py-1.5 min-h-0">
                                    {STATUS_LABELS[s] || s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {order.smm_last_error && (
                              <p
                                className="text-[10px] leading-snug text-destructive break-words"
                                title={order.smm_last_error}
                              >
                                {order.smm_last_error}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-muted-foreground text-xs font-mono hidden md:table-cell align-middle">
                          {order.smm_order_id || "—"}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground text-xs whitespace-nowrap align-middle tabular-nums">
                          {new Date(order.created_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2 pr-4 pl-2 align-middle">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 rounded-md text-destructive/90 hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteOrder(order.id)}
                            aria-label="Excluir pedido"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-border/60">
                <span className="text-xs text-muted-foreground tabular-nums">
                  Página {currentPage} de {totalPages} · {filteredOrders.length} pedidos
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 border-border/80"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 border-border/80"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
          </div>
        </main>
      </div>
    </div>
  );
}
