/** Módulo financeiro: centavos (BRL), rateio 50/50 entre LP Midias e FamaProvider (centavos sobrando no primeiro). */

export const FINANCIAL_STATUS = ["pendente", "pago", "cancelado"] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUS)[number];

/** Rótulos exibidos: Lucas = LP Midias; Fernando = FamaProvider. Coluna `partner_lua` no BD fica 0 nos novos registros. */
export const PARTNER_LP_LABEL = "LP Midias";
export const PARTNER_REF_LABEL = "FamaProvider";

/** Lucro líquido ÷ 2; sobra de centavo fica com LP Midias primeiro. */
export function splitProfitTwoWays(netProfitCents: number): [number, number] {
  const n = Math.trunc(netProfitCents);
  const base = Math.trunc(n / 2);
  let remainder = n - base * 2;
  const shares: [number, number] = [base, base];
  let i = 0;
  while (remainder !== 0 && i < 2) {
    if (remainder > 0) {
      shares[i] += 1;
      remainder -= 1;
    } else {
      shares[i] -= 1;
      remainder += 1;
    }
    i += 1;
  }
  return shares;
}

export function computeFinancialDerived(
  facebookCents: number,
  smmCents: number,
  openaiCents: number,
  receivedCents: number,
): {
  totalCostCents: number;
  netProfitCents: number;
  partnerLucasCents: number;
  partnerLuaCents: number;
  partnerFernandoCents: number;
} {
  const fb = Math.max(0, Math.trunc(facebookCents));
  const smm = Math.max(0, Math.trunc(smmCents));
  const oai = Math.max(0, Math.trunc(openaiCents));
  const rec = Math.max(0, Math.trunc(receivedCents));
  const totalCostCents = fb + smm + oai;
  const netProfitCents = rec - totalCostCents;
  const [lp, ref] = splitProfitTwoWays(netProfitCents);
  return {
    totalCostCents,
    netProfitCents,
    partnerLucasCents: lp,
    partnerLuaCents: 0,
    partnerFernandoCents: ref,
  };
}

/** Soma exibida como “LP Midias” (inclui partner_lua legado de lançamentos antigos ÷3). */
export function lpMidiasTotalCents(row: {
  partner_lucas_cents: number;
  partner_lua_cents: number;
}): number {
  return Math.trunc(row.partner_lucas_cents) + Math.trunc(row.partner_lua_cents);
}

/** Aceita "1.234,56", "1234,56", "1234.56", com ou sem R$. */
export function parseMoneyToCents(raw: string): number {
  const s = raw
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$\s?/gi, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const normalized = hasComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = parseFloat(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function formatBRL(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const v = Math.abs(Math.trunc(cents));
  return `${sign}R$ ${(v / 100).toFixed(2).replace(".", ",")}`;
}

/** Máscara simples para exibir valor monetário com 2 decimais (pt-BR). */
export function centsToInputDisplay(cents: number): string {
  if (!Number.isFinite(cents)) return "";
  return (Math.trunc(cents) / 100).toFixed(2).replace(".", ",");
}

export function sanitizeMoneyKeystroke(prev: string, next: string): string {
  let t = next.replace(/[^\d,.]/g, "");
  const commas = (t.match(/,/g) || []).length;
  if (commas > 1) t = prev;
  return t;
}
