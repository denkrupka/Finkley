-- =============================================================================
-- 20260512000001_other_incomes.sql
-- =============================================================================
-- TASK-54: Прочие доходы — отдельная от visits сущность для нерегулярных
-- поступлений: аренда кресла/места, кэшбек банка, проценты по депозиту,
-- возвраты от поставщиков, прочее.
--
-- Схема похожа на expenses (категория + amount_cents + payment_method + дата
-- + опц. чек/документ), только знак противоположный (это доход).
--
-- В P&L (analytics_kpis) приход = revenue визитов + other_incomes. RPC будет
-- обновлён отдельной миграцией когда будем делать ДДС/cashflow.
-- =============================================================================

-- Категории прочих доходов
create table if not exists public.other_income_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  is_archived boolean not null default false,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.other_income_categories enable row level security;

create policy "members access other_income_categories" on public.other_income_categories
  for all using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );

create index if not exists idx_other_income_categories_salon
  on public.other_income_categories(salon_id, sort_order)
  where is_archived = false;

-- Сами записи прочих доходов
create table if not exists public.other_incomes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  category_id uuid references public.other_income_categories(id) on delete set null,
  income_at date not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_method payment_method,
  comment text,
  receipt_url text,
  source text not null default 'manual',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.other_incomes enable row level security;

create trigger trg_other_incomes_updated_at
  before update on public.other_incomes
  for each row execute procedure public.set_updated_at();

create policy "members access other_incomes" on public.other_incomes
  for all using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );

create index if not exists idx_other_incomes_salon_date
  on public.other_incomes(salon_id, income_at desc)
  where deleted_at is null;
create index if not exists idx_other_incomes_salon_category
  on public.other_incomes(salon_id, category_id, income_at desc)
  where deleted_at is null;

-- Сидим дефолтные категории для всех существующих салонов
insert into public.other_income_categories (salon_id, name, is_system, sort_order)
select s.id, c.name, true, c.sort_order
from public.salons s
cross join (values
  ('Аренда кресла/места', 10),
  ('Кэшбек банка', 20),
  ('Проценты по депозиту', 30),
  ('Возврат от поставщика', 40),
  ('Прочее', 100)
) as c(name, sort_order)
where not exists (
  select 1 from public.other_income_categories
  where salon_id = s.id and name = c.name
);

-- Триггер для будущих салонов — добавляем дефолтные категории при создании
create or replace function public.seed_other_income_categories()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.other_income_categories (salon_id, name, is_system, sort_order)
  values
    (new.id, 'Аренда кресла/места', true, 10),
    (new.id, 'Кэшбек банка', true, 20),
    (new.id, 'Проценты по депозиту', true, 30),
    (new.id, 'Возврат от поставщика', true, 40),
    (new.id, 'Прочее', true, 100);
  return new;
end;
$$;

drop trigger if exists trg_seed_other_income_categories on public.salons;
create trigger trg_seed_other_income_categories
  after insert on public.salons
  for each row execute function public.seed_other_income_categories();
