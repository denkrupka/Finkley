-- =============================================================================
-- 20260505000003_init_services_staff.sql
-- =============================================================================
-- service_categories, services, staff (стадия 1 — упрощённая schema)
-- =============================================================================

-- service_categories
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_categories enable row level security;

create trigger trg_service_categories_updated_at
  before update on service_categories
  for each row execute procedure public.set_updated_at();

create policy "members access service_categories" on service_categories
  for all using (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  );

-- services
create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  category_id uuid references service_categories(id) on delete set null,
  name text not null,
  default_price_cents bigint not null default 0,
  default_duration_min int,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.services enable row level security;

create trigger trg_services_updated_at
  before update on services
  for each row execute procedure public.set_updated_at();

create policy "members access services" on services
  for all using (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  );

-- staff
create type staff_payout_scheme as enum ('fixed', 'percent_revenue', 'percent_service', 'chair_rent', 'mixed');

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  full_name text not null,
  display_color text,
  payout_scheme staff_payout_scheme not null default 'percent_revenue',
  payout_fixed_cents bigint default 0,
  payout_percent numeric(5,2),
  chair_rent_cents bigint default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.staff enable row level security;

create trigger trg_staff_updated_at
  before update on staff
  for each row execute procedure public.set_updated_at();

create policy "members access staff" on staff
  for all using (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  );

-- staff_service_overrides (стадия 2, но создаём с дня 1)
create table public.staff_service_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  payout_percent numeric(5,2),
  unique (staff_id, service_id)
);

alter table public.staff_service_overrides enable row level security;

create policy "via staff" on staff_service_overrides for all using (
  staff_id in (
    select id from staff where salon_id in (
      select salon_id from salon_members where user_id = auth.uid()
    )
  )
);
