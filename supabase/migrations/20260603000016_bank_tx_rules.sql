-- Bug 03.06 (Денис): правила обработки банковских транзакций.
-- 1) auto_create — при появлении tx с counterparty match → создаём
--    expense с category_id из правила, source='bank_ai'. Дубли
--    проверяем через fuzzy match (сумма ± 1 PLN + ±3 дня).
-- 2) ignore — личные траты (SMYK, Biedronka). Не создаём expense,
--    помечаем bank_transactions.is_personal=true + тег 'Личное' в UI.
--
-- В UI: Banking → Параметры → 2 таба:
--   - Правила (контрагент-pattern → категория)
--   - Игнор-лист (контрагенты для пропуска)

create table if not exists public.bank_tx_rules (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  -- Регистронезависимый ILIKE pattern для counterparty или description.
  -- Пример: 'Enea', 'Booksy', 'AquaNet'. Юзер вводит как читается.
  counterparty_pattern text not null,
  -- 'auto_create' — создавать expense; 'ignore' — пропускать.
  action text not null check (action in ('auto_create', 'ignore')),
  -- Категория для auto_create (NULL для ignore).
  category_id uuid references public.expense_categories(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bank_tx_rules_salon on public.bank_tx_rules(salon_id);
create index if not exists idx_bank_tx_rules_pattern
  on public.bank_tx_rules(salon_id, lower(counterparty_pattern));

alter table public.bank_tx_rules enable row level security;

create policy "bank_tx_rules_select" on public.bank_tx_rules
  for select using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );
create policy "bank_tx_rules_insert" on public.bank_tx_rules
  for insert with check (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );
create policy "bank_tx_rules_update" on public.bank_tx_rules
  for update using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );
create policy "bank_tx_rules_delete" on public.bank_tx_rules
  for delete using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );

-- bank_transactions: флаг is_personal для tx помеченных ignore-правилом.
-- В P&L/расходах не отображается (можно фильтровать).
alter table public.bank_transactions
  add column if not exists is_personal boolean not null default false;

create index if not exists idx_bank_transactions_is_personal
  on public.bank_transactions(is_personal) where is_personal = true;

-- Расширяем expenses.source с возможностью 'bank_ai' (для auto-created из
-- bank tx по правилам). Source уже text, не enum — не нужна миграция типа.
comment on column public.expenses.source is
  'Происхождение расхода: manual / ksef / wfirma / fakturownia / infakt / csv_import / auto_commission / bank_ai (auto-created из bank tx по правилам)';
