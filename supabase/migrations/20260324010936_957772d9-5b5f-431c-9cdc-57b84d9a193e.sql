
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
