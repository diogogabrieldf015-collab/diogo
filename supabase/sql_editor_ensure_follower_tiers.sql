-- =============================================================================
-- Rode no SQL Editor se o link /300= estiver cobrando proporcional pelo pacote de 100
-- (ex.: R$ 22,08 em vez de R$ 9,90): falta a LINHA do pacote 300 na tabela.
-- Preço 990 = R$ 9,90 em centavos. Ajuste se o seu valor for outro.
-- Requer índice único (kind, quantity) em packages (migração packages_kind).
-- =============================================================================

INSERT INTO public.packages (quantity, price, discount_price, active, kind)
VALUES (300, 990, NULL, true, 'followers')
ON CONFLICT (kind, quantity) DO UPDATE SET
  price = EXCLUDED.price,
  discount_price = EXCLUDED.discount_price,
  active = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
