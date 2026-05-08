-- Удаляем `integration_credentials` table + `integration_status` view +
-- `integration_provider` enum. Они создавались под ADR-002 «Pragmatic Privacy»
-- для AES-зашифрованных Booksy/wFirma токенов, но в реальности никогда не
-- использовались — Booksy интеграция (см. ADR-008) хранит access_token в
-- jsonb колонке `salon_integrations.credentials` под защитой RLS, а не
-- через app-level encryption.
--
-- Решение про защиту секретов:
--   - Текущая модель: salon_integrations.credentials jsonb защищается RLS
--     (только members салона) + at-rest шифрованием Postgres + изоляцией
--     edge function (только она и service_role видит plaintext)
--   - Booksy access_token живёт ~30 дней, severity = medium. Если когда-то
--     понадобятся долгоживущие creds (wFirma secret_key) — переедем на
--     pgsodium / Vault, не на этот неиспользуемый stub.
--
-- Миграция чистая — table пустая (никогда не записывалось).

drop view if exists public.integration_status;
drop table if exists public.integration_credentials;
drop type if exists integration_provider;
