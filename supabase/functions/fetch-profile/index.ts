import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function normalizeUsername(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/@+/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Aceita vários nomes de campo (gateways / versões antigas / clientes diferentes). */
function rawUserFromBody(body: Record<string, unknown>): string {
  const keys = [
    "instagram_username",
    "instagramUsername",
    "user",
    "username",
    "handle",
    "login",
  ] as const;
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "";
}

/** Quando o serviço externo (/api/profile) não responde, ainda permitimos seguir o fluxo com avatar gerado. */
function syntheticProfile(username: string): Record<string, unknown> {
  const q = encodeURIComponent(username);
  return {
    ok: true,
    username,
    full_name: `@${username}`,
    followers: 0,
    following: 0,
    profile_pic:
      `https://ui-avatars.com/api/?name=${q}&background=0f172a&color=38bdf8&size=256&bold=true`,
    posts: [],
    profile_source: "fallback",
  };
}

function fallbackDisabled(): boolean {
  return Deno.env.get("PROFILE_DISABLE_FALLBACK") === "1";
}

function applyProxyAndLite(
  data: Record<string, unknown>,
  lite: boolean,
  supabaseUrl: string,
): Record<string, unknown> {
  const proxyBase = `${supabaseUrl}/functions/v1/fetch-profile?image=`;
  const pic = data.profile_pic;
  if (typeof pic === "string" && pic.length > 0) {
    if (!pic.includes("ui-avatars.com")) {
      data.profile_pic = proxyBase + encodeURIComponent(pic);
    }
  }
  if (lite) {
    delete data.posts;
  } else if (data.posts && Array.isArray(data.posts)) {
    data.posts = (data.posts as string[]).map((p: string) => proxyBase + encodeURIComponent(p));
  }
  return data;
}

function jsonResponse(body: Record<string, unknown>, cache: string | null): Response {
  const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
  if (cache) headers["Cache-Control"] = cache;
  return new Response(JSON.stringify(body), { headers });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const imageUrl = url.searchParams.get("image");

  if (imageUrl && req.method === "GET") {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      return new Response(blob, {
        headers: {
          ...corsHeaders,
          "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return new Response("Image fetch failed", { status: 502, headers: corsHeaders });
    }
  }

  let rawUser = "";
  let lite = false;

  if (req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ ok: false, error: "Corpo JSON inválido." }, null);
      }
      rawUser = rawUserFromBody(body);
      const l = body.lite;
      lite = l === true || l === 1 || l === "1" || l === "true";
    } catch {
      return jsonResponse({ ok: false, error: "Corpo JSON inválido." }, null);
    }
  } else if (req.method === "GET") {
    rawUser =
      url.searchParams.get("instagram_username") ??
      url.searchParams.get("user") ??
      url.searchParams.get("username") ??
      "";
    lite = url.searchParams.get("lite") === "1" || url.searchParams.get("lite") === "true";
  } else {
    return new Response(JSON.stringify({ ok: false, error: "Método não suportado." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const user = normalizeUsername(rawUser);

  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: "Missing user" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const upstreamBase = (Deno.env.get("PROFILE_API_BASE") ?? "http://187.124.91.24:8080").replace(/\/+$/, "");
  const upstreamUrl = `${upstreamBase}/api/profile?user=${encodeURIComponent(user)}`;
  const timeoutMs = Math.min(Math.max(Number(Deno.env.get("PROFILE_API_TIMEOUT_MS")) || 10_000, 3_000), 60_000);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(upstreamUrl, { signal: ac.signal });

    if (!res.ok) {
      if (!fallbackDisabled()) {
        const syn = applyProxyAndLite(syntheticProfile(user), lite, supabaseUrl);
        return jsonResponse(syn, "no-store");
      }
      return jsonResponse(
        {
          ok: false,
          error: `Serviço de perfil indisponível (HTTP ${res.status}). Configure PROFILE_API_BASE nos secrets ou aguarde.`,
        },
        null,
      );
    }

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      if (!fallbackDisabled()) {
        const syn = applyProxyAndLite(syntheticProfile(user), lite, supabaseUrl);
        return jsonResponse(syn, "no-store");
      }
      return jsonResponse({ ok: false, error: "Resposta inválida do serviço de perfil." }, null);
    }

    if (typeof data.ok === "boolean" && data.ok === false) {
      return jsonResponse(data, "no-store");
    }

    if (!data.profile_source) {
      data.profile_source = "upstream";
    }

    applyProxyAndLite(data, lite, supabaseUrl);

    const cache =
      typeof data.ok === "boolean" && data.ok
        ? "public, max-age=90, s-maxage=90, stale-while-revalidate=300"
        : "no-store";

    return jsonResponse(data, cache);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    if (!fallbackDisabled()) {
      const syn = applyProxyAndLite(syntheticProfile(user), lite, supabaseUrl);
      return jsonResponse(syn, "no-store");
    }
    return jsonResponse(
      {
        ok: false,
        error: aborted
          ? "Tempo esgotado ao buscar o perfil. O Instagram pode estar lento ou o serviço sobrecarregado."
          : "Falha ao contatar o serviço de perfil.",
      },
      null,
    );
  } finally {
    clearTimeout(t);
  }
});
