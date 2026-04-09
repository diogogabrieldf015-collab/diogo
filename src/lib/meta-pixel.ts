/**
 * Meta Pixel — só ativo se VITE_META_PIXEL_ID estiver definido no build.
 * Quando o link de pagamento é o seu site, o cliente abre no navegador e o Meta recebe os eventos.
 */

const PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim() ?? "";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

let initCalled = false;

/** Carrega fbevents.js e fbq('init'). PageView é disparado nas mudanças de rota (App). */
export function initMetaPixel(): void {
  if (!PIXEL_ID || typeof window === "undefined" || initCalled) return;
  initCalled = true;

  const f = window as unknown as Record<string, unknown>;
  if (typeof f.fbq === "function") {
    (f.fbq as (...args: unknown[]) => void)("init", PIXEL_ID);
    return;
  }

  // Snippet oficial Meta (fila até o script carregar)
  (function (
    fbWindow: Record<string, unknown>,
    doc: Document,
    tagName: string,
    src: string,
  ) {
    if (fbWindow.fbq) return;
    const n = (fbWindow.fbq = function (...args: unknown[]) {
      const self = n as { callMethod?: (...a: unknown[]) => void; queue: unknown[] };
      if (self.callMethod) self.callMethod.apply(n, args);
      else self.queue.push(args);
    }) as { push: typeof n; loaded: boolean; version: string; queue: unknown[]; callMethod?: unknown };
    if (!fbWindow._fbq) fbWindow._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const t = doc.createElement(tagName);
    t.async = true;
    t.src = src;
    const s = doc.getElementsByTagName(tagName)[0];
    s?.parentNode?.insertBefore(t, s);
  })(f, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  (f.fbq as (...args: unknown[]) => void)("init", PIXEL_ID);
}

export function metaPixelPageView(): void {
  if (!PIXEL_ID) return;
  window.fbq?.("track", "PageView");
}

export function metaPixelInitiateCheckout(valueBrl: number, contentName: string): void {
  if (!PIXEL_ID || !Number.isFinite(valueBrl) || valueBrl < 0) return;
  window.fbq?.("track", "InitiateCheckout", {
    value: Math.round(valueBrl * 100) / 100,
    currency: "BRL",
    content_name: contentName,
  });
}

export function metaPixelPurchase(valueBrl: number, contentName: string): void {
  if (!PIXEL_ID || !Number.isFinite(valueBrl) || valueBrl < 0) return;
  window.fbq?.("track", "Purchase", {
    value: Math.round(valueBrl * 100) / 100,
    currency: "BRL",
    content_name: contentName,
  });
}
