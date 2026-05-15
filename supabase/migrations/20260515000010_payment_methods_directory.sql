-- =============================================================================
-- payment_methods_directory — справочник методов оплаты per-salon.
-- =============================================================================
-- Каждая запись = маппинг enum-значения payment_method ('cash', 'card',
-- 'transfer', 'online', 'mixed') → отображаемая label + sort_order + видимость.
-- Юзер может:
--   - Переименовать label (например, «Карта» → «Терминал Tpay»)
--   - Изменить порядок (sort_order)
--   - Скрыть из выпадающих списков (is_archived) — на исторические данные
--     не влияет, visit.payment_method остаётся
-- Добавление новых кодов вне enum пока не поддерживается (нужен ALTER TYPE).
-- =============================================================================

create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  code        payment_method not null,
  label       text not null,
  sort_order  int not null default 100,
  is_archived boolean not null default false,
  is_system   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (salon_id, code)
);

create index if not exists idx_payment_methods_salon
  on public.payment_methods(salon_id);

alter table public.payment_methods enable row level security;

-- RLS: участники салона видят и редактируют свои методы. Read — любой member,
-- write — owner/admin.
create policy "payment_methods_select" on public.payment_methods
  for select using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = payment_methods.salon_id
         and sm.user_id = auth.uid()
    )
  );

create policy "payment_methods_insert" on public.payment_methods
  for insert with check (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = payment_methods.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin')
    )
  );

create policy "payment_methods_update" on public.payment_methods
  for update using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = payment_methods.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin')
    )
  );

create policy "payment_methods_delete" on public.payment_methods
  for delete using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = payment_methods.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin')
    )
  );

-- Триггер updated_at
create or replace function public.tg_payment_methods_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payment_methods_updated_at on public.payment_methods;
create trigger trg_payment_methods_updated_at
  before update on public.payment_methods
  for each row execute function public.tg_payment_methods_set_updated_at();

-- =============================================================================
-- Seed: вставляем 5 системных методов в каждый существующий салон.
-- =============================================================================

insert into public.payment_methods (salon_id, code, label, sort_order, is_system)
select s.id, m.code::payment_method, m.label, m.sort_order, true
  from public.salons s
 cross join (values
   ('cash',     'Наличные',  10),
   ('card',     'Карта',     20),
   ('transfer', 'Перевод',   30),
   ('online',   'Онлайн',    40),
   ('mixed',    'Смешанная', 50)
 ) as m(code, label, sort_order)
on conflict (salon_id, code) do nothing;

-- Триггер: при создании нового салона — автоматически добавляем 5 системных
-- методов. Аналогично seed_other_income_categories из предыдущих миграций.
create or replace function public.tg_seed_payment_methods_for_new_salon()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.payment_methods (salon_id, code, label, sort_order, is_system)
  values
    (new.id, 'cash',     'Наличные',  10, true),
    (new.id, 'card',     'Карта',     20, true),
    (new.id, 'transfer', 'Перевод',   30, true),
    (new.id, 'online',   'Онлайн',    40, true),
    (new.id, 'mixed',    'Смешанная', 50, true);
  return new;
end;
$$;

drop trigger if exists trg_seed_payment_methods on public.salons;
create trigger trg_seed_payment_methods
  after insert on public.salons
  for each row execute function public.tg_seed_payment_methods_for_new_salon();

comment on table public.payment_methods is
  'Справочник методов оплаты per-salon. Маппит enum payment_method → label + порядок + видимость. Используется в формах продажи/визита/прочего дохода.';
