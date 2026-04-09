/** Extrai o project ref do host `xxxx.supabase.co`. */
export function projectRefFromSupabaseUrl(url: string): string | null {
  try {
    const hostname = new URL(url.trim()).hostname;
    const m = /^([a-z0-9]{15,})\.supabase\.co$/i.exec(hostname);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Lê o claim `ref` do payload de um JWT anon do Supabase. */
export function jwtPayloadRef(jwt: string): string | null {
  const t = jwt.trim();
  if (!t.startsWith("eyJ")) return null;
  try {
    const part = t.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    const p = JSON.parse(json) as { ref?: string };
    return typeof p.ref === "string" ? p.ref.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Falha cedo se a chave anon (JWT) for de outro projeto que a URL — causa típica de "Invalid API key" no login.
 * Chaves `sb_publishable_` não são JWT; nesse caso não valida.
 */
export function assertSupabaseAnonMatchesUrl(url: string, apiKey: string): void {
  const urlRef = projectRefFromSupabaseUrl(url);
  const keyRef = jwtPayloadRef(apiKey);
  if (!urlRef || !keyRef) return;
  if (urlRef === keyRef) return;
  throw new Error(
    `[Supabase] VITE_SUPABASE_ANON_KEY é do projeto "${keyRef}", mas VITE_SUPABASE_URL é "${urlRef}". ` +
      `Em Settings → API, copie a chave anon do MESMO projeto da Project URL (um JWT novo para ${urlRef}).`,
  );
}
