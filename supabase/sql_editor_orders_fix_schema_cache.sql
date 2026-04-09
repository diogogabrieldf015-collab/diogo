-- =============================================================================
-- Corrige erros do tipo: "Could not find the 'post_url' | 'parent_order_id' |
-- 'product_type' | 'payment_gateway' column of 'orders' in the schema cache"
-- Rode TUDO no SQL Editor (Supabase cloud ou local) — é idempotente (IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS smm_order_id text,
  ADD COLUMN IF NOT EXISTS queued boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'pix',
  ADD COLUMN IF NOT EXISTS smm_last_error text,
  ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'x',
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'followers',
  ADD COLUMN IF NOT EXISTS post_url text,
  ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_product_type ON public.orders (product_type);

COMMENT ON COLUMN public.orders.product_type IS 'followers | likes';
COMMENT ON COLUMN public.orders.post_url IS 'Link da publicação (Instagram) para pedidos de curtidas';

INSERT INTO public.settings (key, value) VALUES ('payment_gateway', 'x')
ON CONFLICT (key) DO NOTHING;

-- Atualiza o cache da API REST (PostgREST)
NOTIFY pgrst, 'reload schema';
