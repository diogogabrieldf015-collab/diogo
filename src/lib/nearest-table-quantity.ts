/**
 * Escolhe a quantidade da **sua tabela** `packages` mais próxima do número pedido no link.
 * Empate na distância → pacote **menor** (menor preço).
 *
 * Exemplos (se a tabela tiver 50, 100, 300, 1000, …):
 * - 300 → 300 (exato)
 * - 250 → 300 (mais perto de 300 que de 100, com tabela 50/100/300/1000…)
 * - 275 → 300
 * - 360 → 300 (mais perto de 300 que de 1000)
 * - 20 → 50 (sobe ao mínimo da tabela)
 * - 999999 → maior pacote da tabela
 */
export function nearestTableQuantity(requested: number, available: number[]): number | null {
  const uniq = [...new Set(available.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (!uniq.length) return null;

  const rq = Math.round(requested);
  if (rq < 1) return uniq[0];

  if (rq <= uniq[0]) return uniq[0];
  if (rq >= uniq[uniq.length - 1]) return uniq[uniq.length - 1];
  if (uniq.includes(rq)) return rq;

  let best = uniq[0];
  let bestDiff = Math.abs(rq - best);
  for (const q of uniq) {
    const d = Math.abs(rq - q);
    if (d < bestDiff || (d === bestDiff && q < best)) {
      best = q;
      bestDiff = d;
    }
  }
  return best;
}
