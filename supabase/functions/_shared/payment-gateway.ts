/** Identificador do gateway X (ExPay) — PIX via /en/purchase/link */
export const GATEWAY_X = "x";

/** SkalePayments — https://docs.skalepayments.com.br */
export const GATEWAY_SKALE = "skale";

const ALLOWED = new Set([GATEWAY_X, GATEWAY_SKALE]);

export function normalizeGatewayId(raw: string | null | undefined): string {
  let v = (raw ?? GATEWAY_X).toString().replace(/^\uFEFF/, "").trim().toLowerCase();
  if (v === "expay" || v === "ex_pay" || v === "xpay") v = GATEWAY_X;
  if (v === "skalepayments" || v === "skale-payments" || v === "skalepay") v = GATEWAY_SKALE;
  return ALLOWED.has(v) ? v : GATEWAY_X;
}

/** Valor em `public.settings` key `payment_gateway` — o admin grava aqui; é a única fonte para novos PIX. */
export async function getActivePaymentGateway(supabase: {
  from: (t: string) => {
    select: (c: string) => {
      eq: (a: string, b: string) => {
        maybeSingle: () => Promise<{ data: { value: string } | null; error: { message?: string } | null }>;
      };
    };
  };
}): Promise<string> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "payment_gateway").maybeSingle();
  if (error) console.warn("[getActivePaymentGateway] settings:", error.message);
  const raw = data?.value;
  const g = normalizeGatewayId(raw);
  console.log("[getActivePaymentGateway] settings payment_gateway:", JSON.stringify(raw), "→", g);
  return g;
}

export function orderPaymentGateway(order: { payment_gateway?: string | null }): string {
  return normalizeGatewayId(order.payment_gateway);
}
