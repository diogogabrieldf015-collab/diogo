/**
 * Faturamento para relatórios: Skale usa valor líquido (após taxa Cash In) quando existir
 * `amount_net_cents`; senão estima com a taxa do painel (percentual + fixa).
 * Taxa de saque (ex. R$ 5 no painel) não entra aqui — é só ao transferir da Skale.
 */
const GATEWAY_SKALE = "skale";

/** Cash In Skale: % sobre o bruto + taxa fixa (valores do seu painel; ajuste se mudarem). */
const SKALE_CASH_IN_PERCENT = 0.0499;
const SKALE_CASH_IN_FIXED_CENTS = 150;

function skaleEstimatedNetCents(grossCents: number): number {
  if (!Number.isFinite(grossCents) || grossCents <= 0) return 0;
  const percentFee = Math.round(grossCents * SKALE_CASH_IN_PERCENT);
  const totalFee = percentFee + SKALE_CASH_IN_FIXED_CENTS;
  return Math.max(0, grossCents - totalFee);
}

export type OrderRevenueInput = {
  amount: number;
  amount_net_cents?: number | null;
  payment_gateway?: string | null;
};

export function orderRevenueCents(order: OrderRevenueInput): number {
  const gw = (order.payment_gateway || "x").toLowerCase().trim();
  if (gw !== GATEWAY_SKALE) return order.amount;
  const net = order.amount_net_cents;
  if (net != null && net >= 0) return net;
  return skaleEstimatedNetCents(order.amount);
}
