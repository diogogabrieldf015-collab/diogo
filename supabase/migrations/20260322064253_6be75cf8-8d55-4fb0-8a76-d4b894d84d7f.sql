ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS smm_order_id text,
  ADD COLUMN IF NOT EXISTS queued boolean NOT NULL DEFAULT false;