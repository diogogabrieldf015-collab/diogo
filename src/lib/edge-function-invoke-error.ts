/**
 * Traduz erros de `supabase.functions.invoke` (especialmente FunctionsHttpError)
 * em texto útil — o SDK só expõe "Edge Function returned a non-2xx status code".
 */
export async function describeEdgeFunctionInvokeError(err: unknown): Promise<string> {
  if (!err || typeof err !== "object") {
    return "Erro ao chamar a Edge Function.";
  }

  const o = err as { name?: string; message?: string; context?: unknown };

  if (o.name === "FunctionsRelayError") {
    return "O Supabase não conseguiu executar a função (relay). Confira se fetch-profile está deployada neste projeto.";
  }

  if (o.name === "FunctionsFetchError") {
    const ctx = o.context;
    const inner =
      ctx instanceof Error
        ? ctx.message
        : ctx && typeof ctx === "object" && "message" in ctx
          ? String((ctx as { message: unknown }).message)
          : "";
    const m = `${o.message || ""} ${inner}`.trim();
    if (m.includes("Failed to fetch") || m.includes("NetworkError") || m.includes("Load failed")) {
      return (
        "O navegador não conseguiu completar a chamada à Edge Function (rede/CORS/extensão). " +
        "Teste em aba anônima, desative bloqueadores para *.supabase.co e confira a internet. " +
        "Se o projeto for novo, faça deploy de fetch-profile no MESMO projeto da VITE_SUPABASE_URL."
      );
    }
    return (
      "Falha de rede ao chamar a Edge Function. " +
      "Confira VITE_SUPABASE_URL, deploy de fetch-profile neste projeto (Dashboard → Edge Functions) e extensões do navegador. " +
      (inner ? `Detalhe: ${inner}` : "")
    );
  }

  if (o.name === "FunctionsHttpError" && o.context instanceof Response) {
    const res = o.context;
    const status = res.status;
    let suffix = "";
    try {
      const ct = res.headers.get("Content-Type") || "";
      if (ct.includes("application/json")) {
        const j = (await res.clone().json()) as Record<string, unknown>;
        const piece =
          (typeof j.error === "string" && j.error) ||
          (typeof j.message === "string" && j.message) ||
          (typeof j.msg === "string" && j.msg) ||
          "";
        if (piece) suffix = ` ${piece}`;
      } else {
        const t = (await res.clone().text()).trim();
        if (t && t.length <= 280) suffix = ` ${t}`;
      }
    } catch {
      /* corpo ilegível */
    }

    if (status === 401 || status === 403) {
      return `Acesso negado (${status}). No .env use VITE_SUPABASE_ANON_KEY (JWT eyJ…) ou a Publishable do mesmo projeto que VITE_SUPABASE_URL.${suffix}`;
    }
    if (status === 404) {
      return `Função fetch-profile não encontrada (404). Faça deploy neste projeto: supabase functions deploy fetch-profile.${suffix}`;
    }
    if (status === 400) {
      return `Requisição inválida (400).${suffix}`.trim();
    }
    if (status >= 500) {
      return `Erro no servidor da Edge Function (${status}). Abra o painel → Edge Functions → fetch-profile → Logs.${suffix}`;
    }
    return `Resposta HTTP ${status} da Edge Function.${suffix}`.trim();
  }

  const msg = typeof o.message === "string" ? o.message : "";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Sem conexão ou URL do Supabase incorreta. Confira VITE_SUPABASE_URL no .env.";
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("JWT")) {
    return "Acesso negado: use VITE_SUPABASE_ANON_KEY (JWT eyJ…) ou publishable válida do mesmo projeto.";
  }
  return msg || "Erro ao chamar a Edge Function.";
}
