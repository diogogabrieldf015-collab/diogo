/** FamaProvider — painel SMM com API estilo Perfect Panel (POST form, action=add) */

const DEFAULT_FAMA_API_BASE = "https://famaprovider.com/api/v2";

export type PlaceSmmResult =
  | { ok: true; order: number }
  | { ok: false; reason: string };

export function getFamaApiKey(): string | null {
  return Deno.env.get("FAMA_API_KEY");
}

/**
 * URL base da API (FamaProvider). Padrão: https://famaprovider.com/api/v2
 * Sobrescreva com o secret FAMA_API_BASE se necessário.
 * GET sem parâmetros costuma retornar "Incorrect request"; o fluxo real é POST (key, action, …).
 */
export function getFamaApiBase(): string {
  const raw = Deno.env.get("FAMA_API_BASE")?.trim();
  return (raw || DEFAULT_FAMA_API_BASE).replace(/\/+$/, "");
}

function parseAddOrderResponse(data: unknown, httpStatus: number, rawText: string): PlaceSmmResult {
  if (!data || typeof data !== "object") {
    return { ok: false, reason: `Resposta inválida (HTTP ${httpStatus})` };
  }
  const o = data as Record<string, unknown>;

  if (o.error != null) {
    const raw = typeof o.error === "string" ? o.error : JSON.stringify(o.error);
    const msg = raw.slice(0, 500);
    const low = msg.toLowerCase();
    if (low.includes("min_quantity") || low.includes("neworder.error.min_quantity")) {
      return {
        ok: false,
        reason:
          `Quantidade abaixo do mínimo deste serviço no painel (${msg}). ` +
          `Aumente o pacote no admin (Seguidores) ou use no painel um serviço que aceite essa quantidade.`,
      };
    }
    return { ok: false, reason: msg };
  }

  const msgField = o.message ?? o.msg ?? o.Message;
  if (typeof msgField === "string" && msgField.toLowerCase().includes("error")) {
    return { ok: false, reason: msgField.slice(0, 500) };
  }

  const raw = o.order ?? o.order_id ?? (o as { Order?: unknown }).Order;
  if (raw === undefined || raw === null || raw === "") {
    const hint = rawText.length > 200 ? rawText.slice(0, 200) + "…" : rawText;
    return {
      ok: false,
      reason: `API não retornou order (HTTP ${httpStatus}). Trecho: ${hint}`,
    };
  }
  const n = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, reason: `ID de pedido inválido na API: ${String(raw)}` };
  }
  return { ok: true, order: n };
}

/** URL do Instagram no formato mais aceito pelos painéis SMM */
export function instagramProfileLink(username: string): string {
  const u = username.replace(/^@/, "").trim();
  return `https://www.instagram.com/${u}/`;
}

/** Normaliza link de publicação (HTTPS, trim). */
export function normalizeSmmLink(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  return s;
}

/**
 * Cria pedido na API com link explícito (perfil ou post).
 */
export async function placeSmmOrderWithLink(
  link: string,
  quantity: number,
  serviceId: string,
): Promise<PlaceSmmResult> {
  const apiKey = getFamaApiKey();
  if (!apiKey) {
    return { ok: false, reason: "FAMA_API_KEY não configurada no Supabase (Secrets)" };
  }

  const base = getFamaApiBase();

  const form = new URLSearchParams();
  form.set("key", apiKey);
  form.set("action", "add");
  form.set("service", String(serviceId).trim());
  form.set("link", link);
  form.set("quantity", String(quantity));

  console.log(
    "FamaProvider add: enviando",
    JSON.stringify({ base, service: String(serviceId).trim(), link, quantity }),
  );

  let res: Response;
  try {
    res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `Rede: ${msg}` };
  }

  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      reason: `Resposta não é JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
    };
  }

  const result = parseAddOrderResponse(data, res.status, text);
  if (!result.ok) {
    console.error("FamaProvider add:", result.reason);
    return result;
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: `HTTP ${res.status} (corpo tinha order, mas status não OK): ${text.slice(0, 200)}`,
    };
  }
  console.log("FamaProvider add: order", result.order);
  return result;
}

/**
 * Cria pedido na API para seguidores (link do perfil).
 */
export async function placeSmmOrder(
  username: string,
  quantity: number,
  serviceId: string,
): Promise<PlaceSmmResult> {
  return placeSmmOrderWithLink(instagramProfileLink(username), quantity, serviceId);
}

/** Perfect Panel costuma mandar `error: false` em sucesso — não tratar como falha. */
function smmStatusResponseHasRealError(data: Record<string, unknown>): boolean {
  const err = data.error;
  if (err == null || err === false) return false;
  if (typeof err === "string" && !err.trim()) return false;
  return true;
}

/** Normaliza texto de status do painel (Perfect Panel). */
function normalizePanelStatusField(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (s === "complete") return "completed";
  if (s === "concluido") return "completed";
  return s;
}

function parseRemainsField(src: Record<string, unknown>, data: Record<string, unknown>): number | null {
  const raw = src.remains ?? src.remain ?? data.remains ?? (data as { Remains?: unknown }).Remains;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Interpreta JSON de `action=status` e devolve status em minúsculas (ou "unknown").
 * Aceita `status` na raiz ou em `order`.
 */
export function parseSmmStatusResponse(data: Record<string, unknown>): string {
  if (smmStatusResponseHasRealError(data)) return "unknown";

  const nested =
    data.order && typeof data.order === "object" && !Array.isArray(data.order)
      ? (data.order as Record<string, unknown>)
      : null;
  const src = nested ?? data;

  const raw = (
    src.status ??
    src.order_status ??
    (src as { order_status_text?: unknown }).order_status_text ??
    data.status ??
    ""
  ).toString();
  const remains = parseRemainsField(src, data);

  let s = normalizePanelStatusField(raw);
  if (!s) s = "unknown";

  const sNorm = s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const looksCanceled =
    sNorm.includes("cancel") || sNorm.includes("refund") || sNorm.includes("reembol");

  // Entrega total: muitos painéis mandam remains=0 com status genérico
  if (remains === 0 && !looksCanceled) {
    return "completed";
  }

  return s || "unknown";
}

/** true se o painel considera o pedido entregue (total ou parcial). */
export function isSmmStatusTerminalDone(normalized: string): boolean {
  const s = normalized.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return [
    "completed",
    "partial",
    "complete",
    "delivered",
    "done",
    "finished",
    "closed",
    "success",
    "concluido",
  ].includes(s);
}

/**
 * Consulta status do pedido no painel SMM (`action=status`).
 */
export async function getSmmOrderStatus(orderId: string): Promise<string> {
  const apiKey = getFamaApiKey();
  if (!apiKey) return "unknown";
  const base = getFamaApiBase();

  const form = new URLSearchParams();
  form.set("key", apiKey);
  form.set("action", "status");
  form.set("order", String(orderId).trim());

  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return "unknown";
    }
    const parsed = parseSmmStatusResponse(data);
    if (parsed === "unknown" && text.length > 0) {
      console.log("[SMM status] order", orderId, "raw snippet:", text.slice(0, 400));
    }
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SMM status] order", orderId, msg);
    return "unknown";
  }
}

// Back-compat: nomes antigos
export const getFlameApiKey = getFamaApiKey;
export const getFlameApiBase = getFamaApiBase;
