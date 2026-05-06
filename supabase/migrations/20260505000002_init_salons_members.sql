-- =============================================================================
-- 20260505000002_init_salons_members.sql
-- =============================================================================
-- salons (мульти-тенант) + salon_members (роли)
-- =============================================================================

-- salons
create table public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code text not null,
  currency text not null default 'PLN',
  timezone text not null default 'Europe/Warsaw',
  salon_type text not null,
  locale text not null default 'ru',
  logo_url text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.salons enable row level security;

create trigger trg_salons_updated_at
  before update on salons
  for each row execute procedure public.set_updated_at();

-- salon_members: связь user ↔ salon с ролями
create type salon_role as enum ('owner', 'admin', 'staff', 'accountant');

create table public.salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role salon_role not null default 'owner',
  staff_id uuid,
  invited_email text,
  invited_at timestamptz,
  joined_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

alter table public.salon_members enable row level security;

-- RLS политики

-- salons: видеть только свои
create policy "members can read their salons" on salons
  for select using (
    id in (select salon_id from salon_members where user_id = auth.uid())
    and deleted_at is null
  );

create policy "owners can update their salons" on salons
  for update using (
    id in (
      select salon_id from salon_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy "anyone authenticated can create a salon" on salons
  for insert with check (auth.uid() = created_by);

-- salon_members
create policy "members can see own membership rows" on salon_members
  for select using (
    user_id = auth.uid()
    or salon_id in (
      select salon_id from salon_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Только сам user создаёт первый membership при создании салона
-- (через edge function create-salon с service-role-key)
-- Прямой insert с клиента запрещён, только через RPC/edge function
