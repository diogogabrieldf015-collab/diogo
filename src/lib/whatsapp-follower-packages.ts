import { normalizeInstagramUsername } from "@/lib/instagram-username";
import { nearestTableQuantity } from "@/lib/nearest-table-quantity";

/**
 * Pacotes oficiais (links diretos). Deve bater com linhas em `packages` (kind = followers).
 * Ordem = exibição sugerida na home.
 */
export const WHATSAPP_FOLLOWER_QUANTITIES = [
  50, 100, 300, 1000, 3000, 5000, 10000, 20000, 50000,
] as const;

export type WhatsappFollowerQuantity = (typeof WHATSAPP_FOLLOWER_QUANTITIES)[number];

const CATALOG_SORTED: number[] = [...WHATSAPP_FOLLOWER_QUANTITIES].sort((a, b) => a - b);
const MIN_Q = CATALOG_SORTED[0];
const MAX_Q = CATALOG_SORTED[CATALOG_SORTED.length - 1];

export function sortPackagesLikeWhatsappList<T extends { quantity: number }>(rows: T[]): T[] {
  const order = new Map(WHATSAPP_FOLLOWER_QUANTITIES.map((q, i) => [q, i]));
  return [...rows].sort((a, b) => {
    const ia = order.get(a.quantity);
    const ib = order.get(b.quantity);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.quantity - b.quantity;
  });
}

export function buildWhatsappFollowerLink(baseUrl: string, quantity: number, username: string): string {
  const u = baseUrl.replace(/\/$/, "");
  const user = normalizeInstagramUsername(username);
  if (!user) return u;
  return `${u}/${quantity}=${encodeURIComponent(user)}`;
}

export type ResolveFollowersResult = {
  /** Quantidade do pacote oficial (vai no link) */
  packageQuantity: number;
  /** O que o cliente pediu (arredondado) */
  requestedRounded: number;
  mode: "exact" | "nearest" | "capped_max" | "raised_min";
};

/**
 * Converte qualquer número pedido pelo cliente no pacote do catálogo correto.
 * - Exato no catálogo → mesmo número
 * - Fora da lista → **mais próximo** por diferença absoluta; empate → pacote **menor** (menor preço)
 * - Abaixo do mínimo → sobe para o menor pacote
 * - Acima do máximo → usa o maior pacote
 */
export function resolveToCatalogFollowers(requested: number): ResolveFollowersResult | null {
  if (!Number.isFinite(requested)) return null;
  const rq = Math.max(0, Math.round(requested));
  if (rq < 1) return null;

  const picked = nearestTableQuantity(rq, [...WHATSAPP_FOLLOWER_QUANTITIES]);
  if (picked == null) return null;

  let mode: ResolveFollowersResult["mode"];
  if (picked === rq) mode = "exact";
  else if (rq < MIN_Q) mode = "raised_min";
  else if (rq > MAX_Q) mode = "capped_max";
  else mode = "nearest";

  return { packageQuantity: picked, requestedRounded: rq, mode };
}

/**
 * Texto pronto para a IA do WhatsApp enviar (você pode usar como template ou exemplo).
 */
export function formatWhatsappBotFollowerMessage(
  siteBaseUrl: string,
  requestedFollowers: number,
  instagramHandle: string,
): string {
  const resolved = resolveToCatalogFollowers(requestedFollowers);
  if (!resolved) {
    return "Me diga quantos seguidores você quer (número) e seu @ do Instagram para eu te mandar o link certo.";
  }

  const link = buildWhatsappFollowerLink(siteBaseUrl, resolved.packageQuantity, instagramHandle);
  const pediu = resolved.requestedRounded.toLocaleString("pt-BR");
  const pacote = resolved.packageQuantity.toLocaleString("pt-BR");

  if (resolved.mode === "exact") {
    return (
      `Segue o link para comprar *${pacote} seguidores* no seu perfil:\n\n${link}\n\n` +
      `Pagamento por PIX, direto no site. Qualquer dúvida, chama aqui.`
    );
  }

  if (resolved.mode === "nearest") {
    return (
      `Trabalhamos só com pacotes fechados no site. O pacote *mais próximo* do que você pediu (${pediu}) é o de *${pacote} seguidores*:\n\n${link}\n\n` +
      `É por esse link que o valor e a entrega batem certinho com o sistema.`
    );
  }

  if (resolved.mode === "raised_min") {
    return (
      `O menor pacote que temos é de *${pacote} seguidores*. Segue o link:\n\n${link}\n\n` +
      `(Você tinha mencionado ${pediu} — esse é o pacote oficial disponível.)`
    );
  }

  return (
    `O maior pacote disponível hoje é de *${pacote} seguidores*. Link:\n\n${link}\n\n` +
    `(Você tinha mencionado ${pediu}.)`
  );
}

/** Bloco para colar nas instruções do sistema da IA (ChatGPT, n8n, etc.). */
export function getWhatsappBotSystemInstructions(siteBaseUrl: string): string {
  const lista = WHATSAPP_FOLLOWER_QUANTITIES.join(", ");
  const exemplo350 = formatWhatsappBotFollowerMessage(siteBaseUrl, 350, "cliente_exemplo");
  return [
    "Você é o atendente no WhatsApp de venda de seguidores para Instagram.",
    "",
    "PACOTES OFICIAIS (únicos válidos no link de pagamento):",
    lista,
    "",
    "FORMATO DO LINK (sempre assim, sem espaços):",
    `${siteBaseUrl.replace(/\/$/, "")}/{QUANTIDADE}={usuario_sem_arroba}`,
    "Exemplo: cliente @joao quer 300 → envie o link com 300=joao",
    "",
    "QUANTIDADE \"QUEBRADA\" (ex.: 350, 1200, 777):",
    "Nunca invente um número que não está na lista. Escolha o pacote da lista cuja quantidade seja a MAIS PRÓXIMA do pedido.",
    "Se empatar (mesma distância entre dois pacotes), prefira o pacote MENOR.",
    "Explique em uma frase que trabalham com pacotes fechados e que esse é o mais próximo.",
    "",
    "EXEMPLO (pedido 350 seguidores):",
    exemplo350,
  ].join("\n");
}
