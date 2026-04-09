import pathlib

root = pathlib.Path(__file__).resolve().parent
migs = sorted((root / "migrations").glob("*.sql"))
header = """-- =============================================================================
-- SCHEMA COMPLETO (todas as migrations em ordem)
-- Supabase: SQL Editor -> colar -> Run
--
-- Extensoes: se falhar pg_cron/pg_net, ative em Database -> Extensions.
-- =============================================================================

"""
parts = [header]
for f in migs:
    parts.append(f"\n\n-- ========== {f.name} ==========\n")
    parts.append(f.read_text(encoding="utf-8"))
parts.append("\n\n-- ========== Fim: recarregar API REST ==========\nNOTIFY pgrst, 'reload schema';\n")
(root / "sql_editor_ALL_IN_ONE.sql").write_text("".join(parts), encoding="utf-8")
print("OK", len(migs), "migrations")
