-- =============================================================================
-- 20260528000003_bank_account_cash_register.sql
-- =============================================================================
-- T73 — связь банковский счёт ↔ касса.
--
-- Юзер в Settings → Интеграции → Банкинг выбирает с каким cash_register
-- связан конкретный bank_account. Используется чтобы:
--   1) В дашборде «Деньги на счетах → Детали» для безналичной кассы со
--      связанным счётом показывать ФАКТИЧЕСКИЙ баланс из bank_transactions
--      (банк уже подтвердил поступления).
--   2) Считать «Ожидается поступление = план (наши проводки) - факт (банк)»
--      — это деньги которые клиент заплатил картой, но эквайринг ещё не
--      провёл их банку. Сигнал что-то не так если разница большая.
--
-- cash_register_id — text, потому что cash_registers хранятся как JSON в
-- salons.financial_settings.cash_registers.items[].id, не отдельная таблица.
-- =============================================================================

alter table public.bank_accounts
  add column if not exists cash_register_id text;

comment on column public.bank_accounts.cash_register_id is
  'T73 — id кассы (financial_settings.cash_registers.items[].id) с типом non_cash, к которой привязан счёт. NULL = счёт без привязки (не учитывается в «Детали кассы»).';

-- ============================================================
-- RPC: balance каждого банк-счёта (sum credit - sum debit)
-- ============================================================

create or replace function public.bank_account_balances(p_salon_id uuid)
returns table (
  account_id uuid,
  cash_register_id text,
  balance_cents bigint,
  currency text,
  last_tx_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    ba.id as account_id,
    ba.cash_register_id,
    coalesce(
      sum(case when bt.type = 'credit' then bt.amount_cents
               when bt.type = 'debit' then -bt.amount_cents
               else 0 end),
      0
    )::bigint as balance_cents,
    ba.currency,
    max(bt.executed_at) as last_tx_at
  from public.bank_accounts ba
  join public.bank_connections bc on bc.id = ba.connection_id
  left join public.bank_transactions bt on bt.account_id = ba.id
  where bc.salon_id = p_salon_id
    and ba.is_active = true
    and bc.status <> 'revoked'
  group by ba.id, ba.cash_register_id, ba.currency;
$$;

revoke all on function public.bank_account_balances(uuid) from public, anon;
grant execute on function public.bank_account_balances(uuid) to authenticated;
