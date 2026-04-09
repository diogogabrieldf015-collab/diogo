/**
 * Igual a src/lib/chopped-package-price.ts — manter alinhado.
 */

export type ChoppedPackageInput = {
  id: string;
  quantity: number;
  price: number;
  discount_price: number | null;
  kind?: string | null;
  active: boolean;
  service_id?: string | null;
};

export type ChoppedPriceResult = {
  amount_cents: number;
  base_quantity: number;
  base_price_cents: number;
  base_package_id: string;
  is_exact: boolean;
};

function kindMatches(rowKind: string | null | undefined, wantedKind: string): boolean {
  const r = (rowKind ?? "").trim().toLowerCase();
  const w = wantedKind.trim().toLowerCase();
  if (r === w) return true;
  if (w === "followers" && r === "") return true;
  return false;
}

export function isChoppedPriceRpcUnavailable(err: { message?: string } | null | undefined): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("could not find the function") ||
    (m.includes("compute_chopped_package_price") && m.includes("could not find"))
  );
}

export function computeChoppedPackagePrice(
  packages: ChoppedPackageInput[],
  requestedQty: number,
  kind: string,
  preferDiscount: boolean,
  serviceIdFilter: string | null,
): ChoppedPriceResult {
  const rq = Math.round(requestedQty);
  if (!Number.isFinite(rq) || rq < 1) {
    throw new Error("Quantidade inválida");
  }

  const sid = (serviceIdFilter ?? "").trim() || null;

  const baseFilter = (p: ChoppedPackageInput) =>
    Boolean(p.active) &&
    Number.isFinite(p.quantity) &&
    p.quantity > 0 &&
    kindMatches(p.kind, kind);

  let candidates = packages.filter(
    (p) => baseFilter(p) && (sid == null ? true : p.service_id === sid),
  );

  if (candidates.length === 0 && sid != null) {
    candidates = packages.filter(baseFilter);
  }

  if (candidates.length === 0) {
    throw new Error(
      "Pacote não encontrado: nenhum pacote ativo de seguidores (kind=followers ou kind vazio). Cadastre no Admin.",
    );
  }

  const exactRow = candidates.find((p) => p.quantity === rq);
  if (exactRow) {
    const eff =
      preferDiscount && exactRow.discount_price != null
        ? exactRow.discount_price
        : exactRow.price;
    const amt = Math.max(1, Math.round(Number(eff)));
    return {
      amount_cents: amt,
      base_quantity: exactRow.quantity,
      base_price_cents: eff,
      base_package_id: exactRow.id,
      is_exact: true,
    };
  }

  const le = candidates.filter((p) => p.quantity <= rq).map((p) => p.quantity);
  const baseQ = le.length > 0 ? Math.max(...le) : Math.min(...candidates.map((p) => p.quantity));

  const row = candidates.find((p) => p.quantity === baseQ);
  if (!row) {
    throw new Error("Pacote não encontrado: inconsistência na tabela de quantidades.");
  }

  const eff =
    preferDiscount && row.discount_price != null ? row.discount_price : row.price;
  let amt = Math.round((rq * eff) / row.quantity);
  if (amt < 1) amt = 1;

  const isExact = candidates.some((p) => p.quantity === rq);

  return {
    amount_cents: amt,
    base_quantity: row.quantity,
    base_price_cents: eff,
    base_package_id: row.id,
    is_exact: isExact,
  };
}
