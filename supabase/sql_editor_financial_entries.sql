-- Cole no SQL Editor do Supabase se ainda não aplicou a migração.
-- Requer função public.update_updated_at_column() (migrações base do app).

CREATE TABLE IF NOT EXISTS public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  description text NOT NULL DEFAULT '',
  client_profile text NOT NULL DEFAULT '',
  facebook_investment_cents integer NOT NULL DEFAULT 0 CHECK (facebook_investment_cents >= 0),
  smm_investment_cents integer NOT NULL DEFAULT 0 CHECK (smm_investment_cents >= 0),
  openai_investment_cents integer NOT NULL DEFAULT 0 CHECK (openai_investment_cents >= 0),
  amount_received_cents integer NOT NULL DEFAULT 0 CHECK (amount_received_cents >= 0),
  total_cost_cents integer NOT NULL DEFAULT 0,
  net_profit_cents integer NOT NULL DEFAULT 0,
  partner_lucas_cents integer NOT NULL DEFAULT 0,
  partner_lua_cents integer NOT NULL DEFAULT 0,
  partner_fernando_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_entry_date ON public.financial_entries (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_entries_status ON public.financial_entries (status);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "financial_entries_select_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_select_authenticated"
  ON public.financial_entries FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "financial_entries_insert_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_insert_authenticated"
  ON public.financial_entries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "financial_entries_update_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_update_authenticated"
  ON public.financial_entries FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "financial_entries_delete_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_delete_authenticated"
  ON public.financial_entries FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS update_financial_entries_updated_at ON public.financial_entries;
CREATE TRIGGER update_financial_entries_updated_at
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
