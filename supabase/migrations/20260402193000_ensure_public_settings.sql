-- Migração anterior estava no histórico sem a tabela existir (DB inconsistente).
CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Settings viewable by everyone" ON public.settings;
CREATE POLICY "Settings viewable by everyone" ON public.settings FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

INSERT INTO public.settings (key, value) VALUES ('smm_service_id', '472')
ON CONFLICT (key) DO NOTHING;
