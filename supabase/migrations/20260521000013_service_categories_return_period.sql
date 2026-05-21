-- =============================================================================
-- 20260521000013_service_categories_return_period.sql
-- =============================================================================
-- Period of return — добавляем service_categories.return_period_days.
-- Юзер хочет в /reports → клиенты увидеть тех, кто не вернулся в ожидаемый
-- срок (маникюр обычно 3-4 недели, эпиляция 6-8 и т.д.).
--
-- Логика:
-- - Каждая категория услуг имеет «нормальный» период возвращаемости в днях.
-- - Если у клиента последний визит услуги из категории был N дней назад,
--   и N > return_period_days, считаем что клиент «нарушил регулярность».
-- - Грейс-период (буфер): +3 дня (отдельная константа на client стороне).
--
-- Дефолтные значения для существующих категорий не выставляем — owner
-- настраивает руками в Settings → Каталог услуг → Параметры.
-- =============================================================================

alter table public.service_categories
  add column if not exists return_period_days int;

comment on column public.service_categories.return_period_days is
  'Ожидаемый период возвращаемости клиента (дней). NULL — не отслеживать. См. /reports → клиенты → Регулярность записей.';

-- Constraint: разумный диапазон (1 день — 365 дней). NULL разрешён (no tracking).
alter table public.service_categories
  drop constraint if exists chk_return_period_days_range;

alter table public.service_categories
  add constraint chk_return_period_days_range
  check (return_period_days is null or (return_period_days >= 1 and return_period_days <= 365));

-- =============================================================================
-- RPC: client_visit_regularity — список клиентов с нарушенной регулярностью.
-- Возвращает client_id, category_id, expected_period_days, days_since_last,
-- last_visit_at, days_overdue.
--
-- Используется в /reports → клиенты → вкладка «Регулярность записей».
-- =============================================================================

create or replace function public.client_visit_regularity(
  p_salon_id uuid,
  p_grace_days int default 3
)
returns table (
  client_id uuid,
  client_name text,
  client_phone text,
  client_email text,
  category_id uuid,
  category_name text,
  expected_period_days int,
  last_visit_at timestamptz,
  days_since_last int,
  days_overdue int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with last_visit_by_category as (
    select
      v.client_id,
      s.category_id,
      max(v.visit_at) as last_visit_at
    from public.visits v
      join public.services s on s.id = v.service_id
    where v.salon_id = p_salon_id
      and v.deleted_at is null
      and v.status <> 'cancelled'
      and v.client_id is not null
      and s.category_id is not null
      and v.kind = 'visit'
    group by v.client_id, s.category_id
  )
  select
    c.id as client_id,
    c.name as client_name,
    c.phone as client_phone,
    c.email as client_email,
    sc.id as category_id,
    sc.name as category_name,
    sc.return_period_days as expected_period_days,
    lv.last_visit_at,
    extract(day from (now() - lv.last_visit_at))::int as days_since_last,
    (extract(day from (now() - lv.last_visit_at))::int - sc.return_period_days) as days_overdue
  from last_visit_by_category lv
    join public.service_categories sc on sc.id = lv.category_id and sc.return_period_days is not null
    join public.clients c on c.id = lv.client_id
  where c.salon_id = p_salon_id
    and c.deleted_at is null
    and sc.is_archived = false
    -- nurнer: визит был дольше return_period_days + grace
    and extract(day from (now() - lv.last_visit_at))::int
        > sc.return_period_days + p_grace_days
  order by (extract(day from (now() - lv.last_visit_at))::int - sc.return_period_days) desc
$$;

grant execute on function public.client_visit_regularity(uuid, int) to authenticated;

comment on function public.client_visit_regularity(uuid, int) is
  'Клиенты которые пропустили ожидаемый период возвращаемости (по категориям услуг). Используется в /reports → клиенты → Регулярность.';
