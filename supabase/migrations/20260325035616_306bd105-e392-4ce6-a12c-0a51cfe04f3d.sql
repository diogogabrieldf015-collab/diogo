
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
