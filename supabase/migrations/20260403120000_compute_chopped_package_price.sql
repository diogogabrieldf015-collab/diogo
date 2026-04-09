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
