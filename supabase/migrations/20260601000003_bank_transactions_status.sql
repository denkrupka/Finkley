-- Добавляем `status` в bank_transactions, чтобы хранить и pending'и (PDNG),
-- и booked. Раньше banking-sync фильтровал `booked` и pending выбрасывал.
-- Результат: юзер не видел свежее поступление до тех пор, пока банк не
-- зафиксирует транзакцию (1–24 часа).
--
-- Теперь:
--   status='pending' — PDNG из EB, не auto-создаём expense (сумма может
--                      измениться). UI показывает значок «в ожидании банка».
--   status='booked'  — окончательная, auto-создаёт expense / соотносится
--                      с visit / попадает в Доходы.
--
-- Переход pending → booked происходит идемпотентно через UNIQUE
-- (account_id, external_id): banking-sync делает UPDATE если строка
-- уже есть, иначе INSERT. Сумма pending → booked перезаписывается
-- (банк может скорректировать на 1–2 цента).

alter table public.bank_transactions
  add column if not exists status text not null default 'booked'
    check (status in ('booked', 'pending'));

create index if not exists idx_bank_tx_status
  on public.bank_transactions(account_id, status, executed_at desc);

comment on column public.bank_transactions.status is
  'booked = окончательная (BOOK/BOOKED у EB), pending = PDNG. UI показывает pending значком, не создаёт expense до booking.';
