-- Valor líquido recebido após taxas Skale (centavos). Preenchido pelo webhook com transaction.net_amount.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS amount_net_cents integer NULL;

COMMENT ON COLUMN public.orders.amount_net_cents IS
  'PIX Skale: valor líquido em centavos (net_amount do gateway). NULL = usar estimativa ou bruto nos relatórios.';
