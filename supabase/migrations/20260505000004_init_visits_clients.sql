-- =============================================================================
-- 20260505000004_init_visits_clients.sql
-- =============================================================================
-- clients + visits (главные таблицы учёта выручки)
-- =============================================================================

-- clients (стадия 2, но создаём с дня 1 чтобы visits.client_id ссылался)
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  birthday date,
  source text,
  tags text[] not null default '{}',
  notes text,
  visit_count int not null default 0,
  total_revenue_cents bigint not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.clients enable row level security;

create trigger trg_clients_updated_at
  before update on clients
  for each row execute procedure public.set_updated_at();

create policy "members access clients" on clients for all using (
  salon_id in (select salon_id from salon_members where user_id = auth.uid())
);

create index idx_clients_salon_phone on clients(salon_id, phone) where deleted_at is null;
create index idx_clients_salon_name on clients(salon_id, lower(name)) where deleted_at is null;

-- visits
create type payment_method as enum ('cash', 'card', 'transfer', 'online', 'mixed');
create type visit_status as enum ('paid', 'pending', 'cancelled');

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  service_name_snapshot text,
  visit_at timestamptz not null,
  amount_cents bigint not null,
  tip_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  payment_method payment_method not null,
  status visit_status not null default 'paid',
  comment text,
  source text not null default 'manual',
  external_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (salon_id, source, external_id)
);

alter table public.visits enable row level security;

create trigger trg_visits_updated_at
  before update on visits
  for each row execute procedure public.set_updated_at();

create policy "members access visits" on visits for all using (
  salon_id in (select salon_id from salon_members where user_id = auth.uid())
);

create index idx_visits_salon_date on visits(salon_id, visit_at desc) where deleted_at is null;
create index idx_visits_salon_staff on visits(salon_id, staff_id, visit_at desc) where deleted_at is null;
create index idx_visits_salon_client on visits(salon_id, client_id) where deleted_at is null;

-- Триггер для денормализации clients stats
create or replace function public.recalc_client_stats()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.client_id is not null) then
    update clients set
      visit_count = visit_count + 1,
      total_revenue_cents = total_revenue_cents + new.amount_cents,
      last_visit_at = greatest(coalesce(last_visit_at, '1970-01-01'::timestamptz), new.visit_at)
    where id = new.client_id;
  elsif (tg_op = 'DELETE' and old.client_id is not null) then
    update clients set
      visit_count = greatest(0, visit_count - 1),
      total_revenue_cents = greatest(0, total_revenue_cents - old.amount_cents)
    where id = old.client_id;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_visits_client_stats
  after insert or delete on visits
  for each row execute procedure recalc_client_stats();
