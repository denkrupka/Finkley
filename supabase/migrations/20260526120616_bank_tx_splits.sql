-- =============================================================================
-- 20260526120616_bank_tx_splits.sql
-- =============================================================================
-- Multi-link: одна банковская транзакция может быть связана с несколькими
-- сущностями (expense / visit / other_income). Раньше chk_bank_tx_single_link
-- запрещал >1 FK на одной tx, что соответствует ≤ 1 связи. Owner-feedback
-- 2026-05-26 (images #32-34): юзер хочет открыть одну tx и выбрать чекбоксами
-- несколько позиций, на которые она «закрывает» оплату.
--
-- Решение: новая таблица `bank_tx_splits` (tx_id, kind, entity_id, amount_cents).
-- Legacy FK на bank_transactions (expense_id / linked_visit_id /
-- linked_other_income_id) ОСТАЮТСЯ как cache «primary link» для случая
-- single-link (back-compat с banking-sync auto-link и обратными модалками).
-- chk_bank_tx_single_link тоже остаётся как guard от случайного двойного
-- write через legacy путь.
--
-- Чтение:
--   - useBankLinkedIncomeIds — UNION (legacy FK) ∪ (splits.entity_id)
--   - Маркер «Банк» в списках расходов/визитов/доходов — линкуется если
--     entity_id появилась в любом из источников.
--
-- Запись:
--   - frontend handleMultiLink: если выбран 1 entity → пишем как раньше
--     (legacy FK через useLinkBankTransaction). splits НЕ создаются.
--   - выбрано N entities → очищаем legacy FK через NULL + создаём N splits.
--   - Backfill для существующих single-link: при первом use multi-select
--     для tx — frontend сам мигрирует legacy FK в split-запись.
-- =============================================================================

create type public.bank_tx_split_kind as enum ('expense', 'visit', 'other_income');

create table public.bank_tx_splits (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  kind public.bank_tx_split_kind not null,
  entity_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  comment text,
  created_at timestamptz not null default now(),
  -- Один (tx, entity_id) на одну строку — не позволяем дубли split'ов
  -- на одну и ту же сущность.
  unique (bank_transaction_id, kind, entity_id)
);

create index idx_bank_tx_splits_tx on public.bank_tx_splits(bank_transaction_id);
create index idx_bank_tx_splits_entity on public.bank_tx_splits(kind, entity_id);

alter table public.bank_tx_splits enable row level security;

-- RLS: member салона может SELECT/INSERT/UPDATE/DELETE через
-- bank_transaction_id → account → connection → salon_members.
create policy "splits_select" on public.bank_tx_splits
  for select using (
    bank_transaction_id in (
      select id from public.bank_transactions
       where account_id in (
         select id from public.bank_accounts
          where connection_id in (
            select id from public.bank_connections
             where salon_id in (
               select salon_id from public.salon_members where user_id = auth.uid()
             )
          )
       )
    )
  );

create policy "splits_modify" on public.bank_tx_splits
  for all using (
    bank_transaction_id in (
      select id from public.bank_transactions
       where account_id in (
         select id from public.bank_accounts
          where connection_id in (
            select id from public.bank_connections
             where salon_id in (
               select salon_id from public.salon_members where user_id = auth.uid()
             )
          )
       )
    )
  )
  with check (
    bank_transaction_id in (
      select id from public.bank_transactions
       where account_id in (
         select id from public.bank_accounts
          where connection_id in (
            select id from public.bank_connections
             where salon_id in (
               select salon_id from public.salon_members where user_id = auth.uid()
             )
          )
       )
    )
  );

comment on table public.bank_tx_splits is
  'Множественная привязка одной bank-tx к нескольким сущностям. Legacy FK
   на bank_transactions используются для single-link (1:1). Multi-link
   (1:N) — через эту таблицу + NULL в legacy FK. Чтение — UNION обоих
   источников через useBankLinkedIncomeIds hook.';
