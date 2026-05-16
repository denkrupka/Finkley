-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000002_accounting_settings.sql
--
-- Image #122: Бухгалтерия в Settings → Профиль.
-- Храним юридические/налоговые данные компании + предпочтения по доставке
-- документов бухгалтеру в новой jsonb-колонке `salons.accounting_settings`.
--
-- Структура (фронт типизирует, БД не enforce'ит):
--   {
--     nip?: string,
--     company_name?: string,
--     address?: string,
--     vat_payer?: boolean,
--     legal_form?: 'jdg' | 'sp_zoo' | 'sp_jawna' | 'sp_komandytowa' | 's_a' |
--                  'fundacja' | 'inne',
--     tax_form?: string,  -- ключ из catalog'а (skala/liniowy/ryczalt/cit/...)
--     tax_rate?: number,  -- процент (8.5, 19, 12, ...)
--     document_delivery?: 'portal' | 'email' | 'both',
--     portal?: string,    -- wfirma|fakturownia|infakt|ksef|other
--     portal_other_name?: string,  -- если portal='other' — название
--     accountant_email?: string
--   }
--
-- Зачем отдельная колонка, а не financial_settings: накопительно засорять
-- финансовый jsonb смесью разных доменов нехорошо; компания/налоги — это
-- отдельный домен, отдельный сериализатор на фронте, отдельный сет ACL
-- (бухгалтер потенциально получит read-доступ к этой колонке, но не к
-- financial_settings).
-- ─────────────────────────────────────────────────────────────────────────────

alter table salons
  add column if not exists accounting_settings jsonb not null default '{}'::jsonb;

comment on column salons.accounting_settings is
  'Юр. данные компании + налоговая схема + предпочтения по доставке документов бухгалтеру. Image #122.';
