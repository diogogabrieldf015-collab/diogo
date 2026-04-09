-- OBSOLETO para o app atual: curtidas usam a tabela packages (kind = likes).
-- Use: sql_editor_packages_kind.sql
--
-- Cole no SQL Editor do Supabase e execute.
--
-- 1) Sempre cria like_packages + políticas finais (curtidas no admin / upsell).
-- 2) Só altera public.orders se essa tabela JÁ EXISTIR (checkout/pedidos do app).
--    Se orders não existir, você verá só curtidas no painel até rodar as migrações
--    base do projeto (tabela orders, packages, etc.).

-- ========== like_packages ==========

CREATE TABLE IF NOT EXISTS public.like_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quantity INTEGER NOT NULL,
  price INTEGER NOT NULL,
  discount_price INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT like_packages_quantity_unique UNIQUE (quantity)
);

ALTER TABLE public.like_packages ENABLE ROW LEVEL SECURITY;

DO $trg$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS update_like_packages_updated_at ON public.like_packages;
    CREATE TRIGGER update_like_packages_updated_at
      BEFORE UPDATE ON public.like_packages
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  ELSE
    RAISE NOTICE 'Função public.update_updated_at_column não existe — trigger em like_packages ignorado (comum em DB novo).';
  END IF;
END
$trg$;

-- Dados iniciais (ignora se quantidade já existir)
INSERT INTO public.like_packages (quantity, price, discount_price, active) VALUES
  (100, 990, NULL, true),
  (500, 3990, NULL, true),
  (1000, 6990, NULL, true)
ON CONFLICT (quantity) DO NOTHING;

-- ========== orders: só se a tabela existir (evita "relation orders does not exist") ==========

DO $blk$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RAISE NOTICE 'Tabela public.orders não encontrada — pulando colunas product_type/post_url e trigger. Rode as migrações base do app quando for usar checkout.';
    RETURN;
  END IF;

  ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'followers',
    ADD COLUMN IF NOT EXISTS post_url text,
    ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

  CREATE INDEX IF NOT EXISTS idx_orders_product_type ON public.orders (product_type);

  COMMENT ON COLUMN public.orders.product_type IS 'followers | likes';
  COMMENT ON COLUMN public.orders.post_url IS 'Link da publicação (Instagram) para pedidos de curtidas';

  CREATE OR REPLACE FUNCTION public.prevent_duplicate_orders()
   RETURNS trigger
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  BEGIN
    DELETE FROM public.orders
    WHERE id != NEW.id
      AND username = NEW.username
      AND quantity = NEW.quantity
      AND COALESCE(product_type, 'followers') = COALESCE(NEW.product_type, 'followers')
      AND status IN ('pending', 'waiting_payment', 'unknown')
      AND transaction_hash IS NULL
      AND created_at >= (now() - interval '5 minutes');

    RETURN NEW;
  END;
  $function$;
END
$blk$;

-- ========== GRANT + RLS (políticas finais) ==========

GRANT SELECT ON public.like_packages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.like_packages TO authenticated;
GRANT ALL ON public.like_packages TO service_role;

DROP POLICY IF EXISTS "Like packages are viewable by everyone" ON public.like_packages;
DROP POLICY IF EXISTS "Admins can manage like_packages" ON public.like_packages;
DROP POLICY IF EXISTS "like_packages_select_public" ON public.like_packages;
DROP POLICY IF EXISTS "like_packages_insert_authenticated" ON public.like_packages;
DROP POLICY IF EXISTS "like_packages_update_authenticated" ON public.like_packages;
DROP POLICY IF EXISTS "like_packages_delete_authenticated" ON public.like_packages;

CREATE POLICY "like_packages_select_public"
  ON public.like_packages FOR SELECT
  USING (true);

CREATE POLICY "like_packages_insert_authenticated"
  ON public.like_packages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "like_packages_update_authenticated"
  ON public.like_packages FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "like_packages_delete_authenticated"
  ON public.like_packages FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);
