-- =============================================================================
-- 20260505000005_init_expenses.sql
-- =============================================================================
-- expense_categories + expenses
-- =============================================================================

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  is_archived boolean not null default false,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.expense_categories enable row level security;

create policy "members access expense_categories" on expense_categories for all using (
  salon_id in (select salon_id from salon_members where user_id = auth.uid())
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  category_id uuid references expense_categories(id) on delete set null,
  expense_at date not null,
  amount_cents bigint not null,
  payment_method payment_method,
  comment text,
  receipt_storage_path text,
  source text not null default 'manual',
  external_id text,
  is_recurring boolean not null default false,
  recurring_period text,
  contractor_name text,
  invoice_number text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (salon_id, source, external_id)
);

alter table public.expenses enable row level security;

create trigger trg_expenses_updated_at
  before update on expenses
  for each row execute procedure public.set_updated_at();

create policy "members access expenses" on expenses for all using (
  salon_id in (select salon_id from salon_members where user_id = auth.uid())
);

create index idx_expenses_salon_date on expenses(salon_id, expense_at desc) where deleted_at is null;
create index idx_expenses_salon_category on expenses(salon_id, category_id, expense_at desc) where deleted_at is null;

-- payouts (стадия 2, готовим schema с дня 1 чтобы не было миграционной возни)
create type payout_status as enum ('draft', 'paid');

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_revenue_cents bigint not null default 0,
  total_payout_cents bigint not null default 0,
  total_advances_cents bigint not null default 0,
  total_deductions_cents bigint not null default 0,
  net_payout_cents bigint not null default 0,
  status payout_status not null default 'draft',
  paid_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payout_lines (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references payouts(id) on delete cascade,
  visit_id uuid references visits(id) on delete set null,
  description text not null,
  amount_cents bigint not null,
  line_type text not null
);

alter table public.payouts enable row level security;
alter table public.payout_lines enable row level security;

create trigger trg_payouts_updated_at
  before update on payouts
  for each row execute procedure public.set_updated_at();

create policy "members access payouts" on payouts for all using (
  salon_id in (select salon_id from salon_members where user_id = auth.uid())
);

create policy "members access payout_lines" on payout_lines for all using (
  payout_id in (
    select id from payouts where salon_id in (
      select salon_id from salon_members where user_id = auth.uid()
    )
  )
);
