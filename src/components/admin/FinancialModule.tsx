import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeFinancialDerived,
  centsToInputDisplay,
  formatBRL,
  parseMoneyToCents,
  PARTNER_LP_LABEL,
  PARTNER_REF_LABEL,
  sanitizeMoneyKeystroke,
} from "@/lib/financial-entry";
import type { TablesInsert } from "@/integrations/supabase/types";
import { FinancialEntryDialog, type FinancialEntryRow } from "./FinancialEntryDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { orderRevenueCents } from "@/lib/order-revenue";
import {
  Bot,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Landmark,
  Loader2,
  Megaphone,
  Pencil,
  RefreshCw,
  Save,
  Server,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const PAGE_SIZE = 15;

const DAILY_CLOSE_DESCRIPTION = "Fechamento do dia";

function isDailyCloseRow(r: FinancialEntryRow) {
  return r.description === DAILY_CLOSE_DESCRIPTION || r.description === "Investimento (Meta + SMM)";
}

const SITE_PAID_STATUSES = new Set([
  "paid",
  "placing_smm",
  "processing",
  "completed",
  "smm_error",
]);

export type FinancialOrderSlice = {
  amount: number;
  status: string;
  created_at: string;
  payment_gateway?: string | null;
  amount_net_cents?: number | null;
};

/** Mesma regra do card "Faturamento" no dashboard: pedidos do dia com status pagos/em fila paga. */
function siteFaturamentoDiaStats(
  orders: FinancialOrderSlice[],
  date: Date,
): { revenueCents: number; paidCount: number } {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  const isInDay = (dateStr: string) => {
    const d = new Date(dateStr);
    return d >= dayStart && d <= dayEnd;
  };
  const paid = orders
    .filter((o) => isInDay(o.created_at))
    .filter((o) => SITE_PAID_STATUSES.has(o.status));
  return {
    revenueCents: paid.reduce((sum, o) => sum + orderRevenueCents(o), 0),
    paidCount: paid.length,
  };
}

const fieldLabel = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

function CardShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  valueClassName,
  sub,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueClassName: string;
  sub?: string;
}) {
  return (
    <CardShell className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wider leading-tight">{label}</span>
      </div>
      <p className={cn("mt-2 text-lg font-bold tabular-nums md:text-xl", valueClassName)}>{value}</p>
      {sub ? <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{sub}</p> : null}
    </CardShell>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={fieldLabel}>
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-muted-foreground tabular-nums">
          R$
        </span>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(sanitizeMoneyKeystroke(value, e.target.value))}
          onBlur={onBlur}
          placeholder="0,00"
          className="h-10 rounded-lg border-border/80 bg-background/70 pl-10 font-mono text-sm tabular-nums shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] transition-shadow focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
          aria-label={label}
        />
      </div>
    </div>
  );
}

export function FinancialModule({
  orders = [],
  onRefreshOrders,
  refreshingOrders = false,
  initialEntryDate,
}: {
  orders?: FinancialOrderSlice[];
  /** Recarrega pedidos no admin (atualiza o faturamento automático). */
  onRefreshOrders?: () => void | Promise<void>;
  refreshingOrders?: boolean;
  /** Alinha com a data do filtro do dashboard (ou hoje se não houver filtro). */
  initialEntryDate?: Date;
}) {
  const [rows, setRows] = useState<FinancialEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FinancialEntryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinancialEntryRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [entryDate, setEntryDate] = useState<Date>(() => {
    if (initialEntryDate) {
      const d = new Date(initialEntryDate);
      d.setHours(12, 0, 0, 0);
      return d;
    }
    return new Date();
  });
  useEffect(() => {
    if (!initialEntryDate) return;
    const d = new Date(initialEntryDate);
    d.setHours(12, 0, 0, 0);
    setEntryDate(d);
  }, [initialEntryDate]);

  const [quickFb, setQuickFb] = useState("");
  const [quickSmm, setQuickSmm] = useState("");
  const [quickOpenai, setQuickOpenai] = useState("");
  const [savingQuick, setSavingQuick] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("financial_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(
        error.message ||
          "Erro ao carregar financeiro. Rode o SQL em supabase/sql_editor_financial_entries.sql",
      );
      setRows([]);
    } else {
      setRows((data as FinancialEntryRow[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeOnly = useMemo(() => rows.filter((r) => r.status !== "cancelado"), [rows]);
  const entryDateStr = useMemo(() => format(entryDate, "yyyy-MM-dd"), [entryDate]);
  const siteDayStats = useMemo(() => siteFaturamentoDiaStats(orders, entryDate), [orders, entryDate]);
  const siteDayCents = siteDayStats.revenueCents;

  const quickSlotEntry = useMemo(() => {
    const matches = rows.filter((r) => r.entry_date === entryDateStr && isDailyCloseRow(r));
    matches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return matches[0] ?? null;
  }, [rows, entryDateStr]);

  const preview = useMemo(() => {
    const fb = parseMoneyToCents(quickFb);
    const smm = parseMoneyToCents(quickSmm);
    const oai = parseMoneyToCents(quickOpenai);
    return computeFinancialDerived(fb, smm, oai, siteDayCents);
  }, [quickFb, quickSmm, quickOpenai, siteDayCents]);

  useEffect(() => {
    if (quickSlotEntry) {
      setQuickFb(centsToInputDisplay(quickSlotEntry.facebook_investment_cents));
      setQuickSmm(centsToInputDisplay(quickSlotEntry.smm_investment_cents));
      setQuickOpenai(centsToInputDisplay(quickSlotEntry.openai_investment_cents ?? 0));
    } else {
      setQuickFb("");
      setQuickSmm("");
      setQuickOpenai("");
    }
  }, [quickSlotEntry, entryDateStr]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const slice = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, pageSafe]);

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const saveDay = async () => {
    const fb = parseMoneyToCents(quickFb);
    const smm = parseMoneyToCents(quickSmm);
    const oai = parseMoneyToCents(quickOpenai);
    const rec = siteDayCents;
    if (fb <= 0 && smm <= 0 && oai <= 0 && rec <= 0) {
      toast.error("Informe pelo menos um gasto ou o faturamento.");
      return;
    }
    const d = computeFinancialDerived(fb, smm, oai, rec);
    setSavingQuick(true);
    try {
      if (quickSlotEntry) {
        const { error } = await supabase
          .from("financial_entries")
          .update({
            entry_date: entryDateStr,
            description: DAILY_CLOSE_DESCRIPTION,
            facebook_investment_cents: fb,
            smm_investment_cents: smm,
            openai_investment_cents: oai,
            amount_received_cents: rec,
            total_cost_cents: d.totalCostCents,
            net_profit_cents: d.netProfitCents,
            partner_lucas_cents: d.partnerLucasCents,
            partner_lua_cents: 0,
            partner_fernando_cents: d.partnerFernandoCents,
          })
          .eq("id", quickSlotEntry.id);
        if (error) throw error;
        toast.success("Atualizado.");
      } else {
        const payload: TablesInsert<"financial_entries"> = {
          entry_date: entryDateStr,
          description: DAILY_CLOSE_DESCRIPTION,
          client_profile: "",
          facebook_investment_cents: fb,
          smm_investment_cents: smm,
          openai_investment_cents: oai,
          amount_received_cents: rec,
          total_cost_cents: d.totalCostCents,
          net_profit_cents: d.netProfitCents,
          partner_lucas_cents: d.partnerLucasCents,
          partner_lua_cents: 0,
          partner_fernando_cents: d.partnerFernandoCents,
          status: "pendente",
          notes: null,
        };
        const { error } = await supabase.from("financial_entries").insert(payload);
        if (error) throw error;
        toast.success("Salvo.");
      }
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSavingQuick(false);
    }
  };

  const openEdit = (r: FinancialEntryRow) => {
    setEditing(r);
    setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("financial_entries").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success("Excluído.");
      setDeleteTarget(null);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir.");
    } finally {
      setDeleting(false);
    }
  };

  const fbCents = parseMoneyToCents(quickFb);
  const smmCents = parseMoneyToCents(quickSmm);
  const oaiCents = parseMoneyToCents(quickOpenai);
  const recCents = siteDayCents;

  return (
    <div className="admin-financial-module w-full space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
          <Landmark className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Financeiro</h2>
      </div>

      <CardShell className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Fechamento do dia</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 border-border/80 justify-start sm:min-w-[200px]"
              >
                <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                {format(entryDate, "dd/MM/yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={entryDate} onSelect={(d) => d && setEntryDate(d)} locale={ptBR} initialFocus />
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="h-9 border-border/80"
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void saveDay()}
            disabled={savingQuick}
            className="h-9 gradient-instagram font-semibold text-primary-foreground shadow-sm hover:opacity-95"
          >
            {savingQuick ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {quickSlotEntry ? "Salvar alterações" : "Gravar fechamento"}
          </Button>
        </div>
      </CardShell>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={DollarSign}
          label={`Faturamento ${format(entryDate, "dd/MM", { locale: ptBR })}`}
          value={formatBRL(recCents)}
          valueClassName="text-primary"
          sub={`${siteDayStats.paidCount} vendas · automático dos pedidos`}
        />
        <StatCard
          icon={Megaphone}
          label="Facebook Ads"
          value={formatBRL(fbCents)}
          valueClassName="text-foreground"
          sub="Meta / Instagram"
        />
        <StatCard
          icon={Server}
          label="Painel SMM"
          value={formatBRL(smmCents)}
          valueClassName="text-foreground"
          sub="Fornecedor"
        />
        <StatCard
          icon={Bot}
          label="OpenAI / API"
          value={formatBRL(oaiCents)}
          valueClassName="text-foreground"
          sub="Tokens e serviços"
        />
      </div>

      <CardShell className="p-4 md:p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <TrendingUp className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-wider">Lucro líquido (preview)</span>
        </div>
        <p
          className={cn(
            "mt-2 text-2xl font-bold tabular-nums tracking-tight md:text-3xl",
            preview.netProfitCents < 0 ? "text-destructive" : "text-primary",
          )}
        >
          {formatBRL(preview.netProfitCents)}
        </p>
        <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custo total</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatBRL(preview.totalCostCents)}
            </p>
          </div>
          <div className="rounded-lg border border-primary/15 bg-primary/[0.06] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/90">{PARTNER_LP_LABEL}</p>
            <p
              className={cn(
                "mt-1 font-mono text-sm font-semibold tabular-nums text-foreground",
                preview.partnerLucasCents < 0 && "text-destructive",
              )}
            >
              {formatBRL(preview.partnerLucasCents)}
            </p>
          </div>
          <div className="rounded-lg border border-primary/15 bg-primary/[0.06] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/90">{PARTNER_REF_LABEL}</p>
            <p
              className={cn(
                "mt-1 font-mono text-sm font-semibold tabular-nums text-foreground",
                preview.partnerFernandoCents < 0 && "text-destructive",
              )}
            >
              {formatBRL(preview.partnerFernandoCents)}
            </p>
          </div>
        </div>
      </CardShell>

      <CardShell className="space-y-5 p-4 md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-foreground">Custos do dia</p>
          {onRefreshOrders ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 border-border/80"
              onClick={() => void onRefreshOrders()}
              disabled={refreshingOrders}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", refreshingOrders && "animate-spin")} />
              Atualizar pedidos
            </Button>
          ) : null}
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField
            id="fin-fb"
            label="Facebook Ads"
            value={quickFb}
            onChange={setQuickFb}
            onBlur={() => setQuickFb(centsToInputDisplay(parseMoneyToCents(quickFb)))}
          />
          <MoneyField
            id="fin-smm"
            label="Painel SMM"
            value={quickSmm}
            onChange={setQuickSmm}
            onBlur={() => setQuickSmm(centsToInputDisplay(parseMoneyToCents(quickSmm)))}
          />
          <MoneyField
            id="fin-oai"
            label="OpenAI / API"
            value={quickOpenai}
            onChange={setQuickOpenai}
            onBlur={() => setQuickOpenai(centsToInputDisplay(parseMoneyToCents(quickOpenai)))}
          />
        </div>
        {quickSlotEntry ? (
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button type="button" variant="outline" size="sm" className="h-9 border-border/80" onClick={() => openEdit(quickSlotEntry)}>
              Edição completa
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(quickSlotEntry)}
            >
              Excluir fechamento
            </Button>
          </div>
        ) : null}
      </CardShell>

      <CardShell className="p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-foreground">Lançamentos recentes</p>
            <p className="text-[11px] text-muted-foreground">
              Até {PAGE_SIZE} por página · {rows.length} no total
            </p>
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-border/80"
                disabled={pageSafe <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-xs tabular-nums text-muted-foreground">
                {pageSafe}/{totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-border/80"
                disabled={pageSafe >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 py-12 text-center text-sm text-muted-foreground">
            Nenhum lançamento ainda. Grave um fechamento para começar.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border/60">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2.5 text-left">Data</th>
                    <th className="px-3 py-2.5 text-right">Meta</th>
                    <th className="px-3 py-2.5 text-right">SMM</th>
                    <th className="px-3 py-2.5 text-right">AI</th>
                    <th className="px-3 py-2.5 text-right">Fat.</th>
                    <th className="px-3 py-2.5 text-right">Lucro</th>
                    <th className="w-[96px] px-3 py-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/40 transition-colors last:border-0 hover:bg-muted/25"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">
                        {format(new Date(r.entry_date + "T12:00:00"), "dd/MM/yy")}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatBRL(r.facebook_investment_cents)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatBRL(r.smm_investment_cents)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatBRL(r.openai_investment_cents ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatBRL(r.amount_received_cents)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-mono text-xs font-medium tabular-nums",
                          r.net_profit_cents < 0 ? "text-destructive" : "text-primary",
                        )}
                      >
                        {formatBRL(r.net_profit_cents)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(r)}
                          aria-label="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(r)}
                          aria-label="Excluir"
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
        )}

        {!loading && rows.length > 0 ? (
          <p className="mt-4 border-t border-border/60 pt-3 text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">{activeOnly.length}</span> ativos · Faturamento acumulado{" "}
            <span className="font-mono text-foreground">{formatBRL(activeOnly.reduce((s, e) => s + e.amount_received_cents, 0))}</span>
            {" · "}
            Lucro acumulado{" "}
            <span className="font-mono text-foreground">{formatBRL(activeOnly.reduce((s, e) => s + e.net_profit_cents, 0))}</span>
          </p>
        ) : null}
      </CardShell>

      <FinancialEntryDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        supabase={supabase}
        entry={editing}
        onSaved={() => void load()}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-xl border-border sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold">Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              O lançamento será removido de forma permanente. Esta ação não pode ser revertida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
