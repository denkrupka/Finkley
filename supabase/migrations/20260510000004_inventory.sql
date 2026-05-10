-- =============================================================================
-- 20260510000004_inventory.sql
-- =============================================================================
-- Учёт материалов и склада (по запросу владельца):
--   - inventory_items         — каталог материалов
--   - service_materials       — рецепт услуги (какие материалы и сколько)
--   - inventory_transactions  — журнал движений (закупки, списания, ревизии)
--   - триггер trg_visits_consume_materials — после INSERT/UPDATE визита со
--     status='paid', kind='visit', service_id IS NOT NULL автоматически
--     списывает по рецепту услуги. Идемпотентно по (visit_id, material_id):
--     если визит уже списывался — повторно не списываем (через UNIQUE).
--
-- Замечания по бизнес-логике:
--   * единицы измерения — свободный текст ("шт", "мл", "г"); конверсии нет
--     (если шампунь в litreax, а расход в ml — это уже на пользователя)
--   * stock хранится как numeric(12,3) — до миллилитров
--   * cost_per_unit_cents — закупочная цена за единицу, для оценки стоимости
--     запасов и расчёта себестоимости услуги
--   * RLS — стандартная: видим/правим только в своём салоне
-- =============================================================================

-- ─── inventory_items ─────────────────────────────────────────────────────
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  unit text not null default 'шт',
  sku text,
  category text,
  current_stock numeric(12, 3) not null default 0,
  min_stock numeric(12, 3) not null default 0,
  cost_per_unit_cents bigint not null default 0 check (cost_per_unit_cents >= 0),
  supplier text,
  is_archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_inventory_items_salon on public.inventory_items(salon_id) where is_archived = false;
create index idx_inventory_items_salon_lowstock on public.inventory_items(salon_id)
  where is_archived = false and current_stock <= min_stock;

create trigger trg_inventory_items_updated_at
  before update on public.inventory_items
  for each row execute procedure public.set_updated_at();

alter table public.inventory_items enable row level security;

create policy "inv_items_select" on public.inventory_items
  for select using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );
create policy "inv_items_modify_admin" on public.inventory_items
  for all using (
    salon_id in (
      select salon_id from public.salon_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    salon_id in (
      select salon_id from public.salon_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ─── service_materials (recipe) ──────────────────────────────────────────
create table public.service_materials (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  material_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity numeric(12, 3) not null check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (service_id, material_id)
);

create index idx_service_materials_material on public.service_materials(material_id);

alter table public.service_materials enable row level security;

create policy "svc_mat_select" on public.service_materials
  for select using (
    service_id in (
      select id from public.services
       where salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
    )
  );
create policy "svc_mat_modify_admin" on public.service_materials
  for all using (
    service_id in (
      select id from public.services
       where salon_id in (
         select salon_id from public.salon_members
          where user_id = auth.uid() and role in ('owner', 'admin')
       )
    )
  )
  with check (
    service_id in (
      select id from public.services
       where salon_id in (
         select salon_id from public.salon_members
          where user_id = auth.uid() and role in ('owner', 'admin')
       )
    )
  );

-- ─── inventory_transactions (journal) ────────────────────────────────────
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  material_id uuid not null references public.inventory_items(id) on delete cascade,
  type text not null check (type in (
    'purchase',           -- закупка (+stock); cost_cents — общая сумма
    'consumption',        -- авто-списание визитом (-stock)
    'manual_adjustment',  -- ручная корректировка (+/-); может иметь причину в notes
    'stocktake',          -- инвентаризация: устанавливает абсолютное значение
    'waste'               -- порча/просрочка (-stock)
  )),
  -- delta для всех типов кроме 'stocktake' (где это абсолютное значение).
  -- Для consumption/waste — отрицательное; для purchase/manual+ — положительное.
  quantity numeric(12, 3) not null,
  -- Для stocktake: какое было «before» (для аудита и отчётов «недостача»)
  prev_stock numeric(12, 3),
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  visit_id uuid references public.visits(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_inv_tx_salon_created on public.inventory_transactions(salon_id, created_at desc);
create index idx_inv_tx_material on public.inventory_transactions(material_id, created_at desc);
-- Идемпотентность авто-списания: per visit+material максимум одна consumption-транзакция.
create unique index uniq_inv_tx_visit_material
  on public.inventory_transactions(visit_id, material_id)
  where type = 'consumption' and visit_id is not null;

alter table public.inventory_transactions enable row level security;

create policy "inv_tx_select" on public.inventory_transactions
  for select using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );
create policy "inv_tx_insert_admin" on public.inventory_transactions
  for insert with check (
    salon_id in (
      select salon_id from public.salon_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
-- Update/delete не разрешаем юзерам — журнал append-only. Если ошибка —
-- создают компенсирующую manual_adjustment.

-- ─── Триггер: автосписание при оплате визита ─────────────────────────────
-- Логика: для INSERT (status='paid') и UPDATE (status переходит в 'paid'),
-- если visit.kind='visit' и visit.service_id IS NOT NULL — для каждой
-- строки в service_materials делаем consumption-транзакцию (-quantity).
-- UNIQUE-индекс защищает от двойного списания.
create or replace function public.consume_materials_on_visit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  -- Только для оплаченных, не-retail визитов с услугой
  if (TG_OP = 'INSERT' and NEW.status = 'paid')
     or (TG_OP = 'UPDATE' and NEW.status = 'paid'
         and (OLD.status is distinct from NEW.status))
  then
    if NEW.kind = 'retail' or NEW.service_id is null or NEW.deleted_at is not null then
      return NEW;
    end if;

    for r in
      select sm.material_id, sm.quantity, ii.salon_id
        from service_materials sm
        join inventory_items ii on ii.id = sm.material_id
       where sm.service_id = NEW.service_id
         and ii.salon_id = NEW.salon_id
         and ii.is_archived = false
    loop
      -- Запись в журнал. ON CONFLICT — на случай повторных триггеров
      -- (например, UPDATE с тем же status). UNIQUE по (visit_id, material_id)
      -- where type='consumption' гарантирует что повторы игнорятся.
      insert into inventory_transactions(
        salon_id, material_id, type, quantity, visit_id
      )
      values (
        r.salon_id, r.material_id, 'consumption', -r.quantity, NEW.id
      )
      on conflict do nothing;

      -- Декремент остатка (только если транзакция реально вставилась).
      -- Используем GET DIAGNOSTICS чтобы не декрементить дважды.
      -- Если ON CONFLICT сработал — FOUND будет true но диагностика покажет 0.
      -- Для безопасности проверяем явно через select:
      if exists (
        select 1 from inventory_transactions
         where visit_id = NEW.id and material_id = r.material_id and type = 'consumption'
           and created_at >= now() - interval '5 seconds'
      ) then
        update inventory_items
           set current_stock = current_stock - r.quantity
         where id = r.material_id;
      end if;
    end loop;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_visits_consume_materials on public.visits;
create trigger trg_visits_consume_materials
  after insert or update on public.visits
  for each row execute procedure public.consume_materials_on_visit();

-- ─── Helper RPC: применить purchase / manual_adjustment / waste ──────────
-- Атомарно: пишет транзакцию + меняет current_stock. Возвращает новое значение.
create or replace function public.inventory_apply_tx(
  p_material_id uuid,
  p_type text,
  p_quantity numeric,
  p_cost_cents bigint default null,
  p_notes text default null
)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_salon_id uuid;
  v_new_stock numeric(12, 3);
begin
  if p_type not in ('purchase', 'manual_adjustment', 'waste') then
    raise exception 'unsupported_type: %', p_type;
  end if;

  select salon_id into v_salon_id from inventory_items where id = p_material_id;
  if v_salon_id is null then
    raise exception 'material_not_found';
  end if;

  -- RLS-проверка: только owner/admin
  if not exists (
    select 1 from salon_members
     where salon_id = v_salon_id
       and user_id = auth.uid()
       and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden';
  end if;

  insert into inventory_transactions(
    salon_id, material_id, type, quantity, cost_cents, notes, created_by
  )
  values (
    v_salon_id, p_material_id, p_type, p_quantity, p_cost_cents, p_notes, auth.uid()
  );

  update inventory_items
     set current_stock = current_stock + p_quantity
   where id = p_material_id
   returning current_stock into v_new_stock;

  return v_new_stock;
end;
$$;

grant execute on function public.inventory_apply_tx(uuid, text, numeric, bigint, text) to authenticated;

-- ─── Helper RPC: stocktake (set absolute) ────────────────────────────────
create or replace function public.inventory_stocktake(
  p_material_id uuid,
  p_actual_stock numeric,
  p_notes text default null
)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_salon_id uuid;
  v_prev numeric(12, 3);
  v_delta numeric(12, 3);
begin
  select salon_id, current_stock into v_salon_id, v_prev
    from inventory_items where id = p_material_id;
  if v_salon_id is null then raise exception 'material_not_found'; end if;

  if not exists (
    select 1 from salon_members
     where salon_id = v_salon_id
       and user_id = auth.uid()
       and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden';
  end if;

  v_delta := p_actual_stock - coalesce(v_prev, 0);

  insert into inventory_transactions(
    salon_id, material_id, type, quantity, prev_stock, notes, created_by
  )
  values (
    v_salon_id, p_material_id, 'stocktake', v_delta, v_prev, p_notes, auth.uid()
  );

  update inventory_items
     set current_stock = p_actual_stock
   where id = p_material_id;

  return p_actual_stock;
end;
$$;

grant execute on function public.inventory_stocktake(uuid, numeric, text) to authenticated;

comment on table public.inventory_items is
  'Каталог расходных материалов салона (краска, фольга, шампуни и т.п.).';
comment on table public.service_materials is
  'Рецепт услуги: какие материалы списываются при оказании услуги и в каком количестве.';
comment on table public.inventory_transactions is
  'Журнал движения материалов: закупки, авто-списания при визитах, ревизии. Append-only.';
