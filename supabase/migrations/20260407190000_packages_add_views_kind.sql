-- Adiciona suporte a "views" (visualizações) no catálogo de packages.
-- Mantém o índice único (kind, quantity) e amplia o CHECK.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'followers';

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_kind_check;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_kind_check CHECK (kind IN ('followers', 'likes', 'views'));

-- Garante índice único composto (caso ainda não exista)
CREATE UNIQUE INDEX IF NOT EXISTS packages_kind_quantity_unique ON public.packages (kind, quantity);

