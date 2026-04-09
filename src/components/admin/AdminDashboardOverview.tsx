import { useId, useMemo, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { orderRevenueCents } from "@/lib/order-revenue";
import { DollarSign, RefreshCw, TrendingUp, Wallet } from "lucide-react";

export type DashboardRange = "hoje" | "7d" | "30d" | "mes";

export type DashboardOrderSlice = {
  amount: number;
  status: string;
  created_at: string;
  payment_method?: string;
  payment_gateway?: string | null;
  amount_net_cents?: number | null;
};

const PAID = new Set(["paid", "placing_smm", "processing", "completed", "smm_error"]);

/** Cor marca vem do tema (CSS vars) */
const BRAND = "hsl(var(--primary))";
const BRAND_SOFT = "hsl(var(--primary) / 0.38)";
const MUTED_SLICE = "hsl(var(--muted))";
/** Fatia “estornadas” no donut de estorno (sem dado real ainda — ver `chargebackPct`). */
const REFUND_SLICE = "hsl(var(--secondary))";

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "mes", label: "Este mês" },
];

function rangeBounds(r: DashboardRange): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  if (r === "hoje") {
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  if (r === "7d") {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  if (r === "30d") {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const d = new Date(iso);
  return d >= start && d <= end;
}

function isPixLike(o: DashboardOrderSlice): boolean {
  const m = (o.payment_method || "pix").toLowerCase();
  return m !== "card";
}

function monthBounds(year: number, month0: number): { start: Date; end: Date } {
  const start = new Date(year, month0, 1, 0, 0, 0, 0);
  const end = new Date(year, month0 + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Rótulos do eixo Y: valores vêm em centavos; exibe atalho em R$ sem vírgula decimal
 * (vírgula em faixa estreita quebrava o SVG em várias linhas — ex.: "1,5k" → "1" / "5k").
 */
function axisCentsShortLabel(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const brl = n / 100;
  if (brl >= 1000) {
    const k = brl / 1000;
    if (k >= 10) return `${Math.round(k)}k`;
    const oneDecimal = (Math.round(k * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return `${oneDecimal}k`;
  }
  return `${Math.round(brl)}`;
}

type Props = {
  orders: DashboardOrderSlice[];
  range: DashboardRange;
  onRangeChange: (r: DashboardRange) => void;
  formatBRL: (cents: number) => string;
  welcomeName: string;
  onOpenOrders: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function AdminDashboardOverview({
  orders,
  range,
  onRangeChange,
  formatBRL,
  welcomeName,
  onOpenOrders,
  onRefresh,
  refreshing,
}: Props) {
  const convDonutGradId = useId().replace(/:/g, "");
  const reduceMotion = usePrefersReducedMotion();
  const { start, end } = useMemo(() => rangeBounds(range), [range]);

  const paidInRange = useMemo(
    () =>
      orders.filter((o) => PAID.has(o.status) && inRange(o.created_at, start, end)),
    [orders, start, end],
  );

  const allInRange = useMemo(
    () => orders.filter((o) => inRange(o.created_at, start, end)),
    [orders, start, end],
  );

  const totalLoadedPaid = useMemo(
    () => orders.filter((o) => PAID.has(o.status)).reduce((s, o) => s + orderRevenueCents(o), 0),
    [orders],
  );

  const periodRevenue = useMemo(
    () => paidInRange.reduce((s, o) => s + orderRevenueCents(o), 0),
    [paidInRange],
  );
  const pixCount = useMemo(() => paidInRange.filter(isPixLike).length, [paidInRange]);
  const avgTicket =
    paidInRange.length > 0 ? Math.round(periodRevenue / paidInRange.length) : 0;

  const conversionPct = useMemo(() => {
    if (allInRange.length === 0) return 0;
    const paidCount = allInRange.filter((o) => PAID.has(o.status)).length;
    return Math.min(100, Math.round((paidCount / allInRange.length) * 10000) / 100);
  }, [allInRange]);

  const monthlyLast12 = useMemo(() => {
    const now = new Date();
    const rows: { mes: string; fat: number; key: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const { start: ms, end: me } = monthBounds(d.getFullYear(), d.getMonth());
      const fat = orders
        .filter((o) => PAID.has(o.status) && inRange(o.created_at, ms, me))
        .reduce((s, o) => s + orderRevenueCents(o), 0);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      rows.push({
        key,
        mes: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        fat,
      });
    }
    return rows;
  }, [orders]);

  const last7DaysSeries = useMemo(() => {
    const endDay = new Date();
    endDay.setHours(23, 59, 59, 999);
    const out: { dia: string; fat: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(endDay);
      day.setDate(day.getDate() - i);
      const ds = new Date(day);
      ds.setHours(0, 0, 0, 0);
      const de = new Date(day);
      de.setHours(23, 59, 59, 999);
      const fat = orders
        .filter((o) => PAID.has(o.status) && inRange(o.created_at, ds, de))
        .reduce((s, o) => s + orderRevenueCents(o), 0);
      out.push({
        dia: day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
        fat,
      });
    }
    return out;
  }, [orders]);

  const hourlyLast7d = useMemo(() => {
    const { start: ws } = rangeBounds("7d");
    const buckets = Array.from({ length: 24 }, (_, h) => ({ h: `${String(h).padStart(2, "0")}:00`, total: 0 }));
    for (const o of orders) {
      if (!PAID.has(o.status)) continue;
      const t = new Date(o.created_at);
      if (t < ws) continue;
      buckets[t.getHours()].total += orderRevenueCents(o);
    }
    return buckets;
  }, [orders]);

  const convPaidFill = reduceMotion ? BRAND : `url(#${convDonutGradId})`;

  const convPieData = useMemo(() => {
    if (allInRange.length === 0) return null;
    const p = conversionPct;
    if (p >= 99.995) return [{ name: "Pagos", value: 100, fill: convPaidFill }];
    if (p <= 0) return [{ name: "Demais", value: 100, fill: MUTED_SLICE }];
    return [
      { name: "Pagos", value: p, fill: convPaidFill },
      { name: "Demais", value: 100 - p, fill: MUTED_SLICE },
    ];
  }, [allInRange.length, conversionPct, convPaidFill]);

  /** % de estorno no período (placeholder até haver campo nos pedidos). */
  const chargebackPct = 0;

  const refundPieData = useMemo(() => {
    const p = chargebackPct;
    if (p >= 99.995) return [{ name: "Estornadas", value: 100, fill: REFUND_SLICE }];
    if (p <= 0) return [{ name: "Não estornadas", value: 100, fill: MUTED_SLICE }];
    return [
      { name: "Estornadas", value: p, fill: REFUND_SLICE },
      { name: "Não estornadas", value: 100 - p, fill: MUTED_SLICE },
    ];
  }, [chargebackPct]);

  /** Recharts aplica cor escura no valor por padrão; forçar amarelo marca para leitura no fundo escuro. */
  const tooltipStyle = {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
    color: BRAND,
  };
  const tooltipLabelStyle = { color: BRAND, fontWeight: 600 as const };
  const tooltipItemStyle = { color: BRAND };

  const refundTooltipStyle = {
    ...tooltipStyle,
    color: REFUND_SLICE,
  };
  const refundTooltipLabelStyle = { color: REFUND_SLICE, fontWeight: 600 as const };
  const refundTooltipItemStyle = { color: REFUND_SLICE };

  const CardShell = ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm transition-all duration-300 hover:border-primary/20 hover:shadow-[0_0_28px_-12px_hsl(var(--primary)/0.18)]",
        className,
      )}
    >
      {children}
    </div>
  );

  return (
    <div className="admin-dashboard-chart-tooltips admin-dashboard-tech space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">
            Bem-vindo de volta{welcomeName && welcomeName !== "—" ? `, ${welcomeName}` : ""}
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Visão geral</h2>
          <p className="text-xs text-muted-foreground">
            Pedidos pagos e em andamento · baseado nos últimos pedidos carregados no painel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant={range === value ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-8 text-xs transition-all duration-200",
                range === value &&
                  "border-0 gradient-instagram font-semibold text-primary-foreground hover:opacity-95 dash-tech-range-active dash-tech-sheen",
                range !== value &&
                  "border-border/70 bg-background/30 hover:border-primary/45 hover:bg-primary/[0.07] hover:text-foreground",
              )}
              onClick={() => onRangeChange(value)}
            >
              <span className="relative z-10">{label}</span>
            </Button>
          ))}
          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 border-border/70 transition-all duration-200 hover:border-primary/45 hover:bg-primary/[0.08] hover:text-primary"
              disabled={refreshing}
              onClick={() => onRefresh()}
              aria-label="Atualizar dados"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardShell className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="h-4 w-4 text-primary dash-tech-icon" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Receita carregada</span>
          </div>
          <p className="dash-tech-metric mt-2 text-lg font-bold tabular-nums text-primary md:text-xl">
            {formatBRL(totalLoadedPaid)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">Soma paga · amostra atual</p>
        </CardShell>
        <CardShell className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4 text-primary dash-tech-icon" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Faturamento · período</span>
          </div>
          <p className="dash-tech-metric mt-2 text-lg font-bold tabular-nums text-primary md:text-xl">
            {formatBRL(periodRevenue)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">{paidInRange.length} vendas pagas</p>
        </CardShell>
        <CardShell className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-primary dash-tech-icon" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">PIX / não-cartão</span>
          </div>
          <p className="dash-tech-metric mt-2 text-lg font-bold tabular-nums text-primary md:text-xl">{pixCount}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">No período selecionado</p>
        </CardShell>
        <CardShell className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4 text-primary dash-tech-icon" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Ticket médio</span>
          </div>
          <p className="dash-tech-metric mt-2 text-lg font-bold tabular-nums text-primary md:text-xl">
            {formatBRL(avgTicket)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">Por venda paga no período</p>
        </CardShell>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardShell className="p-4 md:p-5">
          <p className="text-sm font-semibold text-foreground">Faturamento mensal</p>
          <p className="text-[11px] text-muted-foreground">Últimos 12 meses · pedidos pagos</p>
          <div className="mt-4 h-56 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyLast12} margin={{ top: 4, right: 8, left: 2, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashFatFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                  </linearGradient>
                  <filter id="dashMonthlyStrokeGlow" x="-60%" y="-60%" width="220%" height="220%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="mes" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                  width={52}
                  tickFormatter={axisCentsShortLabel}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={(v: number) => [formatBRL(v), ""]}
                />
                <Area
                  type="monotone"
                  dataKey="fat"
                  name="Faturamento"
                  stroke={BRAND}
                  strokeWidth={2.5}
                  fill="url(#dashFatFill)"
                  filter="url(#dashMonthlyStrokeGlow)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        <CardShell className="p-4 md:p-5">
          <p className="text-sm font-semibold text-foreground">Desempenho no período</p>
          <p className="text-[11px] text-muted-foreground">Conversão = pagos ÷ pedidos criados no intervalo</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center">
              <div className="h-36 w-full max-w-[160px]">
                {convPieData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      {!reduceMotion && (
                        <defs>
                          <linearGradient
                            id={convDonutGradId}
                            gradientUnits="objectBoundingBox"
                            x1="0"
                            y1="0.5"
                            x2="1"
                            y2="0.5"
                          >
                            <stop offset="0%" stopColor="#0c1929" />
                            <stop offset="38%" stopColor={BRAND} />
                            <stop offset="50%" stopColor="#B0E2FF" />
                            <stop offset="62%" stopColor={BRAND} />
                            <stop offset="100%" stopColor="#082f4a" />
                            <animateTransform
                              attributeName="gradientTransform"
                              type="rotate"
                              from="0 0.5 0.5"
                              to="360 0.5 0.5"
                              dur="8s"
                              repeatCount="indefinite"
                            />
                          </linearGradient>
                        </defs>
                      )}
                      <Pie
                        data={convPieData}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        innerRadius="58%"
                        outerRadius="88%"
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                      >
                        {convPieData.map((e, i) => (
                          <Cell key={i} fill={e.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={tooltipItemStyle}
                        formatter={(v: number) => [`${Number(v).toFixed(2)}%`, ""]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-[11px] text-muted-foreground">
                    Sem pedidos no período
                  </div>
                )}
              </div>
              <p className="mt-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Taxa de conversão
              </p>
              <p className="dash-tech-metric text-lg font-bold tabular-nums text-primary">
                {allInRange.length === 0 ? "—" : `${conversionPct.toFixed(2)}%`}
              </p>
            </div>
            <div className="flex flex-col items-center">
              <div className="h-36 w-full max-w-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={refundPieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius="58%"
                      outerRadius="88%"
                      stroke="hsl(var(--background))"
                      strokeWidth={2}
                    >
                      {refundPieData.map((e, i) => (
                        <Cell key={i} fill={e.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={refundTooltipStyle}
                      labelStyle={refundTooltipLabelStyle}
                      itemStyle={refundTooltipItemStyle}
                      formatter={(v: number) => [`${Number(v).toFixed(2)}%`, ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Taxa de estorno
              </p>
              <p className="dash-tech-metric text-lg font-bold tabular-nums text-primary">{`${chargebackPct.toFixed(2)}%`}</p>
              <div className="mt-2 flex flex-col gap-1.5 text-left text-[9px] text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-background" style={{ background: REFUND_SLICE }} />
                  <span>Estornadas</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-background" style={{ background: MUTED_SLICE }} />
                  <span>Não estornadas</span>
                </div>
              </div>
            </div>
          </div>
        </CardShell>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardShell className="p-4 md:p-5">
          <p className="text-sm font-semibold text-foreground">Faturamento · últimos 7 dias</p>
          <p className="text-[11px] text-muted-foreground">Pedidos pagos por dia</p>
          <div className="mt-4 h-52 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={last7DaysSeries} margin={{ top: 4, right: 8, left: 2, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashWeekFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND_SOFT} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                  </linearGradient>
                  <filter id="dashWeekStrokeGlow" x="-60%" y="-60%" width="220%" height="220%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="dia" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                  width={52}
                  tickFormatter={axisCentsShortLabel}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={(v: number) => [formatBRL(v), ""]}
                />
                <Area
                  type="monotone"
                  dataKey="fat"
                  stroke={BRAND}
                  strokeWidth={2.5}
                  fill="url(#dashWeekFill)"
                  filter="url(#dashWeekStrokeGlow)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        <CardShell className="p-4 md:p-5">
          <p className="text-sm font-semibold text-foreground">Pedidos pagos por horário</p>
          <p className="text-[11px] text-muted-foreground">
            Últimos 7 dias · soma do faturamento (R$) por hora do dia, no seu fuso
          </p>
          <div className="mt-4 h-52 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyLast7d} margin={{ top: 4, right: 8, left: 2, bottom: 0 }}>
                <defs>
                  <filter id="dashBarGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="h" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 8 }} interval={3} />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                  width={52}
                  tickFormatter={axisCentsShortLabel}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={(v: number) => [formatBRL(v), ""]}
                />
                <Bar dataKey="total" radius={[3, 3, 0, 0]} filter="url(#dashBarGlow)">
                  {hourlyLast7d.map((_, i) => (
                    <Cell key={i} fill={BRAND} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>
      </div>

      <CardShell className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Pedidos e fila</p>
          <p className="text-xs text-muted-foreground">Abra a lista completa para alterar status e sincronizar SMM.</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onOpenOrders}
          className="shrink-0 border-0 gradient-instagram font-semibold text-primary-foreground hover:opacity-95 dash-tech-cta dash-tech-sheen"
        >
          <span className="relative z-10">Abrir pedidos</span>
        </Button>
      </CardShell>
    </div>
  );
}
