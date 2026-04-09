/**
 * Skale envia `transaction.net_amount` em reais (string "13.61") no postback.
 * @see https://docs.skalepayments.com.br — Webhooks e postbacks
 */
export function parseSkaleNetAmountCentsFromPayload(payload: Record<string, unknown>): number | null {
  const tx = payload.transaction as Record<string, unknown> | undefined;
  const raw = tx?.net_amount ?? payload.net_amount;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 100);
  }
  return null;
}
