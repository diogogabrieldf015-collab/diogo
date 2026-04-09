-- PRÉ-REQUISITO: rode antes a migração 20260402121000_like_packages_and_orders.sql
-- (CREATE TABLE like_packages + colunas em orders). Sem a tabela, este arquivo falha com:
-- relation "public.like_packages" does not exist

-- Garantir permissões e políticas RLS explícitas em like_packages (insert/update costumavam falhar
-- com FOR ALL em alguns projetos Supabase).

GRANT SELECT ON public.like_packages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.like_packages TO authenticated;
GRANT ALL ON public.like_packages TO service_role;

DROP POLICY IF EXISTS "Like packages are viewable by everyone" ON public.like_packages;
DROP POLICY IF EXISTS "Admins can manage like_packages" ON public.like_packages;

CREATE POLICY "like_packages_select_public"
  ON public.like_packages FOR SELECT
  USING (true);

CREATE POLICY "like_packages_insert_authenticated"
  ON public.like_packages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "like_packages_update_authenticated"
  ON public.like_packages FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "like_packages_delete_authenticated"
  ON public.like_packages FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);
