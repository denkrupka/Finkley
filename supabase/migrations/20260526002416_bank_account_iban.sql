-- =============================================================================
-- 20260526002416_bank_account_iban.sql
-- =============================================================================
-- IBAN на counterparties / scheduled_payments / expenses для bulk-экспорта
-- переводов в банк (Раунд 2 — фундамент). Без CHECK constraint на IBAN
-- формат — разрешаем любую страну (PL стандарт 28 знаков, EU 15..34).
--
-- Логика заполнения (см. Раунд 4):
--   counterparties.bank_account_iban — единый счёт контрагента. При создании
--     нового scheduled_payment с IBAN + counterparty — спрашиваем
--     «записать счёт контрагенту?». При выборе counterparty в форме
--     scheduled_payment — auto-fill из counterparties.bank_account_iban.
--   scheduled_payments.bank_account_iban — для экспорта в банк. Default
--     заполняется из counterparty при выборе.
--   expenses.bank_account_iban — если расход оплачен переводом, копируется
--     из scheduled_payment.bank_account_iban или OCR/KSeF auto-fill.
-- =============================================================================

alter table public.counterparties
  add column if not exists bank_account_iban text;
comment on column public.counterparties.bank_account_iban is
  'IBAN счёта контрагента для bulk-экспорта переводов в банк. Заполняется
   вручную при создании контрагента, через OCR/KSeF auto-detect, или через
   confirm-prompt при создании первого scheduled_payment.';

alter table public.scheduled_payments
  add column if not exists bank_account_iban text,
  add column if not exists counterparty_id uuid references public.counterparties(id) on delete set null;
comment on column public.scheduled_payments.bank_account_iban is
  'IBAN получателя — используется в bulk-экспорте в банк. Auto-fill из
   counterparties.bank_account_iban при выборе контрагента.';
comment on column public.scheduled_payments.counterparty_id is
  'Контрагент-получатель (см. expenses.counterparty_id). Нужен для:
   1) cross-fill IBAN из counterparty.bank_account_iban при выборе,
   2) confirm-prompt «записать счёт контрагенту» при новом IBAN,
   3) красивого имени в bulk-экспорте (вместо vendor_name).';

create index if not exists idx_scheduled_payments_counterparty
  on public.scheduled_payments(counterparty_id)
  where counterparty_id is not null;

alter table public.expenses
  add column if not exists bank_account_iban text;
comment on column public.expenses.bank_account_iban is
  'IBAN получателя — для расходов оплаченных переводом. OCR/KSeF auto-detect
   или копия из scheduled_payment при «Оплатить запланированное».';
