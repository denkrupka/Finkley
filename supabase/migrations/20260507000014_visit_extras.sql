-- =============================================================================
-- 20260507000014_visit_extras.sql
-- =============================================================================
-- TASK-24/25 финал — все 4 фичи в одной миграции:
--   #1 Multi-row visits grid → только UI, новые таблицы не нужны
--   #2 Visit templates (повторяющиеся шаблоны) → таблица visit_templates
--   #3 Budget vs actual → колонка expense_categories.monthly_budget_cents
--   #4 Cash on hand → колонка salons.opening_cash_balance_cents +
--                     RPC compute_cash_balance
-- =============================================================================

-- =============================================================================
-- #4 Cash on hand
-- =============================================================================
alter table public.salons
  add column if not exists opening_cash_balance_cents bigint not null default 0;

create or replace function public.compute_cash_balance(p_salon_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    coalesce(s.opening_cash_balance_cents, 0)
    + coalesce((
        select sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0))
          from visits
         where salon_id = p_salon_id
           and status = 'paid' and deleted_at is null
           and payment_method = 'cash'
      ), 0)
    - coalesce((
        select sum(amount_cents)
          from expenses
         where salon_id = p_salon_id and deleted_at is null
           and payment_method = 'cash'
      ), 0)
    from salons s
   where s.id = p_salon_id;
$$;

grant execute on function public.compute_cash_balance(uuid) to authenticated;

-- =============================================================================
-- #3 Budget vs actual
-- =============================================================================
alter table public.expense_categories
  add column if not exists monthly_budget_cents bigint;

create or replace function public.category_budgets_progress(p_salon_id uuid)
returns table (
  category_id     uuid,
  name            text,
  monthly_budget_cents bigint,
  current_month_cents  bigint,
  progress_pct    numeric(5,2)
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id as category_id,
    c.name,
    c.monthly_budget_cents,
    coalesce((
      select sum(amount_cents)
        from expenses
       where salon_id = p_salon_id
         and category_id = c.id
         and deleted_at is null
         and expense_at >= date_trunc('month', current_date)::date
    ), 0)::bigint as current_month_cents,
    case when c.monthly_budget_cents is null or c.monthly_budget_cents = 0
         then null
         else round(
           100.0 * coalesce((
             select sum(amount_cents)
               from expenses
              where salon_id = p_salon_id
                and category_id = c.id
                and deleted_at is null
                and expense_at >= date_trunc('month', current_date)::date
           ), 0) / c.monthly_budget_cents,
           2
         )
    end as progress_pct
    from expense_categories c
   where c.salon_id = p_salon_id and c.is_archived = false
   order by c.sort_order, c.name;
$$;

grant execute on function public.category_budgets_progress(uuid) to authenticated;

-- =============================================================================
-- #2 Visit templates (повторяющиеся визиты)
-- =============================================================================
create table if not exists public.visit_templates (
  id                uuid primary key default gen_random_uuid(),
  salon_id          uuid not null references salons(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  staff_id          uuid references staff(id) on delete set null,
  service_id        uuid references services(id) on delete set null,
  recurrence_days   int not null check (recurrence_days > 0),
  amount_cents      bigint, -- если null — берётся services.default_price_cents
  next_due_at       date not null,
  paused_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_visit_templates_salon_due
  on public.visit_templates(salon_id, next_due_at)
  where paused_at is null;

create index if not exists idx_visit_templates_client
  on public.visit_templates(client_id);

alter table public.visit_templates enable row level security;

create policy "members access visit_templates" on public.visit_templates
  for all using (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  )
  with check (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  );

create trigger trg_visit_templates_updated_at
  before update on public.visit_templates
  for each row execute procedure public.set_updated_at();

-- RPC: возвращает шаблоны клиентов с next_due_at <= today + N дней,
-- enriched именами клиента/мастера/услуги.
create or replace function public.upcoming_visit_templates(
  p_salon_id uuid,
  p_horizon_days int default 7
)
returns table (
  id              uuid,
  client_id       uuid,
  client_name     text,
  staff_id        uuid,
  staff_name      text,
  service_id      uuid,
  service_name    text,
  recurrence_days int,
  next_due_at     date,
  days_until      int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    vt.id,
    vt.client_id,
    c.name as client_name,
    vt.staff_id,
    s.full_name as staff_name,
    vt.service_id,
    sv.name as service_name,
    vt.recurrence_days,
    vt.next_due_at,
    (vt.next_due_at - current_date)::int as days_until
    from visit_templates vt
    join clients c on c.id = vt.client_id
    left join staff s on s.id = vt.staff_id
    left join services sv on sv.id = vt.service_id
   where vt.salon_id = p_salon_id
     and vt.paused_at is null
     and vt.next_due_at <= (current_date + p_horizon_days * interval '1 day')::date
   order by vt.next_due_at;
$$;

grant execute on function public.upcoming_visit_templates(uuid, int) to authenticated;
