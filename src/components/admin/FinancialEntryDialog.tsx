import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/integrations/supabase/types";
import {
  computeFinancialDerived,
  centsToInputDisplay,
  FINANCIAL_STATUS,
  formatBRL,
  PARTNER_LP_LABEL,
  PARTNER_REF_LABEL,
  parseMoneyToCents,
  sanitizeMoneyKeystroke,
  type FinancialStatus,
} from "@/lib/financial-entry";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type FinancialEntryRow = Tables<"financial_entries">;

const STATUS_LABEL: Record<FinancialStatus, string> = {
  pendente: "Pendente",
  pago: "Pago",
  cancelado: "Cancelado",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supabase: SupabaseClient<Database>;
  entry: FinancialEntryRow | null;
  onSaved: () => void;
};

const lbl = "text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground";

function Dm({ id, label, value, onChange, onBlur }: { id: string; label: string; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={lbl}>
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-muted-foreground">R$</span>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(sanitizeMoneyKeystroke(value, e.target.value))}
          onBlur={onBlur}
          placeholder="0,00"
          className="h-11 rounded-md border-border/90 pl-10 font-mono text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-primary/15"
        />
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 border-b border-border/80 pb-6 last:border-0 last:pb-0">
      <p className={lbl}>{title}</p>
      {children}
    </div>
  );
}

export function FinancialEntryDialog({ open, onOpenChange, supabase, entry, onSaved }: Props) {
  const [entryDate, setEntryDate] = useState("");
  const [description, setDescription] = useState("");
  const [clientProfile, setClientProfile] = useState("");
  const [fbStr, setFbStr] = useState("");
  const [smmStr, setSmmStr] = useState("");
  const [openaiStr, setOpenaiStr] = useState("");
  const [receivedStr, setReceivedStr] = useState("");
  const [status, setStatus] = useState<FinancialStatus>("pendente");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setEntryDate(entry.entry_date.slice(0, 10));
      setDescription(entry.description);
      setClientProfile(entry.client_profile);
      setFbStr(centsToInputDisplay(entry.facebook_investment_cents));
      setSmmStr(centsToInputDisplay(entry.smm_investment_cents));
      setOpenaiStr(centsToInputDisplay(entry.openai_investment_cents ?? 0));
      setReceivedStr(centsToInputDisplay(entry.amount_received_cents));
      setStatus((entry.status as FinancialStatus) || "pendente");
      setNotes(entry.notes ?? "");
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setEntryDate(today);
      setDescription("");
      setClientProfile("");
      setFbStr("");
      setSmmStr("");
      setOpenaiStr("");
      setReceivedStr("");
      setStatus("pendente");
      setNotes("");
    }
  }, [open, entry]);

  const preview = useMemo(() => {
    const fb = parseMoneyToCents(fbStr);
    const smm = parseMoneyToCents(smmStr);
    const oai = parseMoneyToCents(openaiStr);
    const rec = parseMoneyToCents(receivedStr);
    return computeFinancialDerived(fb, smm, oai, rec);
  }, [fbStr, smmStr, openaiStr, receivedStr]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fb = parseMoneyToCents(fbStr);
    const smm = parseMoneyToCents(smmStr);
    const oai = parseMoneyToCents(openaiStr);
    const rec = parseMoneyToCents(receivedStr);
    const d = computeFinancialDerived(fb, smm, oai, rec);

    if (!entryDate) {
      toast.error("Informe a data.");
      return;
    }

    setSaving(true);
    try {
      const payload: TablesInsert<"financial_entries"> = {
        entry_date: entryDate,
        description: description.trim(),
        client_profile: clientProfile.trim(),
        facebook_investment_cents: fb,
        smm_investment_cents: smm,
        openai_investment_cents: oai,
        amount_received_cents: rec,
        total_cost_cents: d.totalCostCents,
        net_profit_cents: d.netProfitCents,
        partner_lucas_cents: d.partnerLucasCents,
        partner_lua_cents: d.partnerLuaCents,
        partner_fernando_cents: d.partnerFernandoCents,
        status,
        notes: notes.trim() || null,
      };

      if (entry) {
        const { error } = await supabase.from("financial_entries").update(payload).eq("id", entry.id);
        if (error) throw error;
        toast.success("Atualizado.");
      } else {
        const { error } = await supabase.from("financial_entries").insert(payload);
        if (error) throw error;
        toast.success("Criado.");
      }
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const row = (a: string, b: string, bClass?: string) => (
    <div className="flex justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{a}</span>
      <span className={cn("font-mono text-sm font-semibold tabular-nums", bClass)}>{b}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-xl border-border/90 p-0 shadow-lg sm:max-w-lg">
        <DialogHeader className="border-b border-border/80 bg-muted/20 px-5 py-5 text-left sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/90">Financeiro</p>
          <DialogTitle className="mt-2 text-xl font-semibold tracking-tight">
            {entry ? "Editar lançamento" : "Novo lançamento"}
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm leading-relaxed">
            Valores em reais (BRL). Participações calculadas automaticamente: {PARTNER_LP_LABEL} e {PARTNER_REF_LABEL}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 space-y-6">
            <Block title="Geral">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fe-date" className={lbl}>
                    Data
                  </Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="fe-date"
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      className="h-11 rounded-md pl-10"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fe-status" className={lbl}>
                    Status
                  </Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as FinancialStatus)}>
                    <SelectTrigger id="fe-status" className="h-11 rounded-md">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FINANCIAL_STATUS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fe-desc" className={lbl}>
                  Descrição
                </Label>
                <Input id="fe-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="h-11 rounded-md" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fe-client" className={lbl}>
                  Cliente / perfil
                </Label>
                <Input id="fe-client" value={clientProfile} onChange={(e) => setClientProfile(e.target.value)} className="h-11 rounded-md" />
              </div>
            </Block>

            <Block title="Gastos">
              <div className="grid gap-4 sm:grid-cols-2">
                <Dm id="fe-fb" label="Facebook" value={fbStr} onChange={setFbStr} onBlur={() => setFbStr(centsToInputDisplay(parseMoneyToCents(fbStr)))} />
                <Dm id="fe-smm" label="SMM" value={smmStr} onChange={setSmmStr} onBlur={() => setSmmStr(centsToInputDisplay(parseMoneyToCents(smmStr)))} />
                <Dm
                  id="fe-oai"
                  label="OpenAI"
                  value={openaiStr}
                  onChange={setOpenaiStr}
                  onBlur={() => setOpenaiStr(centsToInputDisplay(parseMoneyToCents(openaiStr)))}
                />
                <Dm
                  id="fe-rec"
                  label="Recebido"
                  value={receivedStr}
                  onChange={setReceivedStr}
                  onBlur={() => setReceivedStr(centsToInputDisplay(parseMoneyToCents(receivedStr)))}
                />
              </div>
            </Block>

            <div className="rounded-lg border border-border/90 bg-muted/25 px-4 py-1 divide-y divide-border/70">
              {row("Custo total", formatBRL(preview.totalCostCents))}
              {row(
                "Lucro",
                formatBRL(preview.netProfitCents),
                preview.netProfitCents < 0 ? "text-red-400" : "text-primary",
              )}
              {row(PARTNER_LP_LABEL, formatBRL(preview.partnerLucasCents))}
              {row(PARTNER_REF_LABEL, formatBRL(preview.partnerFernandoCents))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="fe-notes" className={lbl}>
                Observações
              </Label>
              <Textarea
                id="fe-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="resize-none min-h-[80px] rounded-md border-border/90"
              />
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border/80 bg-card px-5 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-6">
            <Button type="button" variant="outline" className="h-10 rounded-md sm:min-w-[100px]" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="h-10 min-w-[120px] rounded-md gradient-instagram font-semibold text-primary-foreground"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
