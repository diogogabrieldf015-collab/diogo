-- Garante pacote 300 seguidores (R$ 9,90 = 990 centavos) para links /300= cobrarem a tabela, não só proporcional pelo 100.
INSERT INTO public.packages (quantity, price, discount_price, active, kind)
VALUES (300, 990, NULL, true, 'followers')
ON CONFLICT (kind, quantity) DO UPDATE SET
  price = EXCLUDED.price,
  discount_price = EXCLUDED.discount_price,
  active = true,
  updated_at = now();
