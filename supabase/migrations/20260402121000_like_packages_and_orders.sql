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
