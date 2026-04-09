-- Cole no SQL Editor (mesmo projeto do app). Curtidas passam a usar a tabela packages (como seguidores).
-- Depois: NOTIFY pgrst, 'reload schema'; se quiser refrescar a API.

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

NOTIFY pgrst, 'reload schema';
