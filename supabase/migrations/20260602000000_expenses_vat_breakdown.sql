-- expenses.vat_rate_pct + amount_net_cents — для VAT-разбивки (NET/VAT/GROSS).
--
-- Бизнес-логика:
--   amount_cents — БРУТТО (сумма с НДС, как было раньше — обратная
--   совместимость для всех существующих расходов)
--   amount_net_cents — НЕТТО (без НДС)
--   vat_rate_pct — ставка НДС в процентах (0, 5, 8, 23 для PL)
--
-- При импорте из KSeF/OCR суммы заполняются автоматически. При ручном
-- вводе UI даёт двусторонний пересчёт.
--
-- Зачем храним нетто отдельно, а не вычисляем: ставка НДС может иметь
-- дробь (0.083, 0.05) и при обратном пересчёте теряется копейка из-за
-- округления — лучше зафиксировать обе суммы как введены.

alter table public.expenses
  add column if not exists vat_rate_pct numeric(5, 2),
  add column if not exists amount_net_cents bigint;

comment on column public.expenses.vat_rate_pct is
  'Ставка НДС в процентах (0, 5, 8, 23 для PL). NULL = старый расход без VAT-разбивки.';
comment on column public.expenses.amount_net_cents is
  'Сумма нетто (без НДС). amount_cents = брутто (с НДС). NULL = старый расход.';

-- То же для scheduled_payments (не оплаченные фактуры из KSeF тоже нужны).
alter table public.scheduled_payments
  add column if not exists vat_rate_pct numeric(5, 2),
  add column if not exists amount_net_cents bigint;
