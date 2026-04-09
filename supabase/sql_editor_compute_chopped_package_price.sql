-- =============================================================================
-- COLE ESTE ARQUIVO INTEIRO NO: Supabase Dashboard → SQL Editor → Run
-- Corrige: "Could not find the function ..." e garante cálculo correto.
-- Depois: Settings → API → "Reload schema" (se o app ainda não achar a RPC).
-- O app também calcula o mesmo preço em fallback (sem RPC) se o PostgREST estiver com cache atrasado —
-- confira se VITE_SUPABASE_URL é o MESMO projeto onde você rodou este SQL.
--
-- IMPORTANTE — colunas packages.price e discount_price:
--   Devem estar em CENTAVOS (inteiro), igual ao painel admin do app.
--   Ex.: R$ 7,36 → 736. Se você gravar 7 ou 7.36 “em reais” no inteiro, o valor do PIX fica errado.
--
-- Teste rápido após rodar (troque 310 se quiser):
--   select * from public.compute_chopped_package_price(310, 'followers', false, null);
--   Esperado: amount_cents = arredondamento de (310 * preço_base_centavos / qtd_base).
--
-- Se o link for /300= e NÃO existir pacote ATIVO com quantity=300, o sistema usa o maior
-- pacote abaixo (ex.: 100) e o valor fica proporcional (ex.: R$ 22,08). Igual ao concorrente:
-- cadastre a linha 300 (990 centavos = R$ 9,90) — use sql_editor_ensure_follower_tiers.sql.
-- =============================================================================

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS service_id text NULL;

COMMENT ON COLUMN public.packages.service_id IS 'Opcional: id do serviço SMM; usado quando p_service_id é informado na RPC.';

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

  -- 1) Quantidade = linha na tabela → preço do pacote (ex. 300 seg → 990 centavos, não proporcional pelo 100)
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

  -- 2) Picado: maior quantity <= pedido; se pedido < mínimo, menor pacote
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
  'Exato: preço da linha. Picado: max(quantity)<=pedido (senão min); total em centavos.';

GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO service_role;

-- Ajuda o PostgREST a enxergar a função nova sem esperar o cache expirar
NOTIFY pgrst, 'reload schema';
