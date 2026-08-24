-- [EXEMPLO] Separação de papéis no banco (Step 5 — RLS). Roda só na 1ª criação
-- do volume do Postgres local. No prod, os roles são criados pelo IaC/Terraform.
--   • users_owner  → dono do schema; roda migrations (DDL + RLS). NÃO-super,
--     logo o FORCE ROW LEVEL SECURITY o alcança.
--   • users_app    → runtime da aplicação (não-owner); recebe só DML pelos
--     grants da migration de RLS. É sobre ele que a policy corta por tenant.
-- Senhas de DEV: em produção vêm de Secret/IaC, nunca de arquivo versionado.
--
-- Para EXERCITAR a RLS localmente (opcional):
--   DB_MIGRATION_USERNAME=users_owner DB_MIGRATION_PASSWORD=users_owner_dev --     DB_APP_ROLE=users_app npm run migration:run
--   e rode a app com DB_USERNAME=users_app / DB_PASSWORD=users_app_dev.
-- Sem isso, o fluxo simples (app como superusuário) ignora a RLS — cômodo p/ dev.
CREATE ROLE users_owner LOGIN PASSWORD 'users_owner_dev';
CREATE ROLE users_app   LOGIN PASSWORD 'users_app_dev';
GRANT CREATE, USAGE ON SCHEMA public TO users_owner;
