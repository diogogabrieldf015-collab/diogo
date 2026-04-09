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

