-- =============================================================================
-- 20260512000002_cash_flow_and_payments.sql
-- =============================================================================
-- TASK-55: RPC cash_flow_daily — по дням за период приход/расход/нетто.
-- TASK-56: таблица scheduled_payments — платёжный календарь (будущие платежи
--          поставщикам, recurring, ручные плановые).
-- =============================================================================

-- =============================================================================
-- TASK-55: cash_flow_daily — приход/расход по дням за период
-- =============================================================================
-- Приход = visits (amount - discount + tip) + other_incomes
-- Расход = expenses
-- Группировка по days с учётом salon.timezone (visits.visit_at — timestamptz).
-- other_incomes.income_at и expenses.expense_at — date, timezone-aware
-- группировка не нужна.

create or replace function public.cash_flow_daily(
  p_salon_id uuid,
  p_from date,
  p_to date
) returns table (
  day date,
  inflow_cents bigint,
  outflow_cents bigint,
  net_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with tz as (
    select coalesce(s.timezone, 'Europe/Warsaw') as tz
    from public.salons s
    where s.id = p_salon_id
  ),
  visit_flows as (
    select
      (v.visit_at at time zone (select tz from tz))::date as day,
      sum(
        coalesce(v.amount_cents, 0)
        - coalesce(v.discount_cents, 0)
        + coalesce(v.tip_cents, 0)
      )::bigint as amt
    from public.visits v
    where v.salon_id = p_salon_id
      and v.deleted_at is null
      and v.status <> 'cancelled'
      and (v.visit_at at time zone (select tz from tz))::date between p_from and p_to
    group by 1
  ),
  other_in_flows as (
    select income_at as day, sum(amount_cents)::bigint as amt
    from public.other_incomes
    where salon_id = p_salon_id
      and deleted_at is null
      and income_at between p_from and p_to
    group by 1
  ),
  expense_flows as (
    select expense_at as day, sum(amount_cents)::bigint as amt
    from public.expenses
    where salon_id = p_salon_id
      and deleted_at is null
      and expense_at between p_from and p_to
    group by 1
  ),
  all_days as (
    select generate_series(p_from, p_to, '1 day'::interval)::date as day
  )
  select
    d.day,
    (coalesce(vf.amt, 0) + coalesce(oi.amt, 0))::bigint as inflow_cents,
    coalesce(ef.amt, 0)::bigint as outflow_cents,
    (coalesce(vf.amt, 0) + coalesce(oi.amt, 0) - coalesce(ef.amt, 0))::bigint as net_cents
  from all_days d
  left join visit_flows vf on vf.day = d.day
  left join other_in_flows oi on oi.day = d.day
  left join expense_flows ef on ef.day = d.day
  order by d.day;
$$;

revoke all on function public.cash_flow_daily(uuid, date, date) from public;
grant execute on function public.cash_flow_daily(uuid, date, date) to authenticated;

-- =============================================================================
-- TASK-56: scheduled_payments — платёжный календарь
-- =============================================================================
-- Источники:
--   manual     — юзер вручную добавил «надо оплатить»
--   wfirma     — авто-импорт неоплаченных фактур из wFirma (TODO: edge function)
--   fakturownia — аналогично
--   ksef       — аналогично
--   recurring  — генерируется из expenses.recurrence (TODO: cron)
--
-- Status:
--   pending — ожидает оплаты, due_date в будущем или сегодня
--   overdue — due_date прошёл, не оплачено (вычисляется на UI)
--   paid    — оплачено, связано с expense через paid_expense_id

do $$ begin
  if not exists (select 1 from pg_type where typname = 'scheduled_payment_status') then
    create type scheduled_payment_status as enum ('pending', 'paid');
  end if;
end $$;

create table if not exists public.scheduled_payments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  category_id uuid references public.expense_categories(id) on delete set null,
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  vendor_name text,
  invoice_number text,
  comment text,
  status scheduled_payment_status not null default 'pending',
  paid_at timestamptz,
  paid_expense_id uuid references public.expenses(id) on delete set null,
  source text not null default 'manual',
  external_id text, -- id фактуры в портале источнике (wfirma/fakturownia/ksef)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (salon_id, source, external_id)
);

alter table public.scheduled_payments enable row level security;

create trigger trg_scheduled_payments_updated_at
  before update on public.scheduled_payments
  for each row execute procedure public.set_updated_at();

create policy "members access scheduled_payments" on public.scheduled_payments
  for all using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );

create index if not exists idx_scheduled_payments_salon_due
  on public.scheduled_payments(salon_id, due_date)
  where deleted_at is null and status = 'pending';
create index if not exists idx_scheduled_payments_salon_status
  on public.scheduled_payments(salon_id, status, due_date desc)
  where deleted_at is null;

comment on table public.scheduled_payments is
  'Платёжный календарь — предстоящие/просроченные платежи поставщикам. '
  'Источники: manual, wfirma, fakturownia, ksef, recurring. Источники '
  'wfirma/fakturownia/ksef заполнятся автоматически из соответствующих sync '
  'функций (TODO).';
