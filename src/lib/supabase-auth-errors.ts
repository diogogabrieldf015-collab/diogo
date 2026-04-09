/** Mensagens amigáveis para erros comuns do `signInWithPassword` / Auth. */
export function describeAuthSignInError(err: { message?: string } | null): string {
  const raw = (err?.message ?? "").trim();
  const m = raw.toLowerCase();

  if (!raw) {
    return "Não foi possível entrar. Confira a conexão e se o .env aponta para o projeto certo do Supabase.";
  }

  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) {
    return "E-mail ou senha incorretos. Se o usuário foi criado no painel, use a senha que você definiu e confira se está no mesmo projeto da VITE_SUPABASE_URL.";
  }

  if (m.includes("email not confirmed")) {
    return "Este e-mail ainda não foi confirmado. No Supabase: Authentication → Users → abra o usuário e marque “Email Confirmed”, ou desative “Confirm email” em Authentication → Providers → Email.";
  }

  if (m.includes("too many requests") || m.includes("rate limit")) {
    return "Muitas tentativas. Aguarde um minuto e tente de novo.";
  }

  if (m.includes("user not found")) {
    return "Usuário não encontrado neste projeto. Confira se criou o login no mesmo projeto da URL do .env.";
  }

  if (m.includes("invalid api key")) {
    return "Chave da API rejeitada pelo Supabase Auth. No painel → Settings → API, copie a chave anon pública (JWT que começa com eyJ…) para VITE_SUPABASE_ANON_KEY no .env, no mesmo projeto da VITE_SUPABASE_URL. Só sb_publishable_ costuma falhar no login.";
  }

  return raw;
}
