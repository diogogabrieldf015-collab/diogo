-- Rode no SQL Editor do MESMO projeto do VITE_SUPABASE_URL do seu .env
-- (Settings → API → Project URL deve bater com a URL do app)

-- 1) A tabela existe neste banco?
SELECT to_regclass('public.like_packages') AS tabela_ok;

-- 2) Forçar o PostgREST a recarregar o schema (API REST)
NOTIFY pgrst, 'reload schema';

-- 3) Alternativa equivalente (alguns ambientes respondem melhor)
SELECT pg_notify('pgrst', 'reload schema');

-- Depois: espere 30–60 s, no site do admin faça Ctrl+Shift+R (recarregar sem cache).
