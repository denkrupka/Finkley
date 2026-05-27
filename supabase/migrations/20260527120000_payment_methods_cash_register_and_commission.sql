-- =============================================================================
-- payment_methods: cash_register_id + commission_pct
-- =============================================================================
-- Расширяем справочник методов оплаты двумя полями:
--
--   cash_register_id text  — id кассы из salons.financial_settings.cash_registers.items[].id
--                            При оплате методом X средства зачисляются на эту кассу
--                            автоматически (визиты, продажи, прочие доходы).
--                            text, а не FK — потому что кассы хранятся в jsonb settings,
--                            не отдельной таблицей.
--
--   commission_pct numeric(5,2) default 0 — % комиссии метода. При оплате
--                            автоматически создаётся расход в системной категории
--                            «Комиссии» = paid_amount * commission_pct / 100.
--                            Связан с источником (visit_id / other_income_id) через
--                            metadata, чтобы пересчитать/удалить при правках.
--
-- Дефолтная привязка cash_register_id заполняется фронтом при первом открытии
-- вкладки «Методы оплаты» (по cash_kind/payment_method_mapping legacy).
-- =============================================================================

alter table public.payment_methods
  add column if not exists cash_register_id text,
  add column if not exists commission_pct numeric(5,2) not null default 0;

comment on column public.payment_methods.cash_register_id is
  'ID кассы (financial_settings.cash_registers.items[].id) куда зачисляются средства при оплате этим методом.';

comment on column public.payment_methods.commission_pct is
  '% комиссии от транзакции. Автоматически создаётся расход в системной категории «Комиссии» при оплате.';
