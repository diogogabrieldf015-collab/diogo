/**
 * Chave pública do projeto no browser.
 * `VITE_SUPABASE_ANON_KEY` (JWT eyJ…) tem precedência — o Auth costuma recusar só `sb_publishable_`
 * (“Invalid API key” no login). Mesmo projeto que VITE_SUPABASE_URL.
 */
export function getSupabaseBrowserApiKey(): string {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const pub = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof anon === "string" && anon.trim()) return anon.trim();
  return String(pub ?? "").trim();
}
