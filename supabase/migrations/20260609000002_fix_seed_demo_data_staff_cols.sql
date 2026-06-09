-- =============================================================================
-- 20260609000002_fix_seed_demo_data_staff_cols.sql
-- =============================================================================
-- Bug (баг-трекер): кнопка «Попробовать на демо-данных» падала с ошибкой.
--
-- Причина: seed_demo_data (20260508000018) обращался к НЕсуществующим колонкам
-- таблицы staff:
--   - payout_percent_revenue  → в staff такой колонки нет (есть payout_percent)
--   - is_archived             → в staff её нет (это флаг services/categories;
--                               у staff — is_active + deleted_at)
-- Postgres падал на «column "is_archived" does not exist», клиент ловил ошибку
-- в catch → toast.error.
--
-- Фикс: пересоздаём функцию, поправив ТОЛЬКО staff-блок:
--   payout_scheme='percent_revenue', payout_percent=40;
--   фильтр активных мастеров → is_active = true and deleted_at is null.
-- Остальные блоки (services/clients/visits/expenses) корректны и не тронуты.
-- =============================================================================

create or replace function public.seed_demo_data(p_salon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_role text;
  v_staff_ids uuid[];
  v_service_ids uuid[];
  v_client_ids uuid[];
  v_category_id uuid;
  v_count_staff int;
  v_count_services int;
  v_count_clients int;
  v_count_visits int;
  v_count_expenses int;
  v_visit_at timestamptz;
  v_amount int;
begin
  -- Только owner/admin салона может сидить демо-данные
  select role into v_member_role
  from salon_members
  where salon_id = p_salon_id and user_id = auth.uid();
  if v_member_role is null or v_member_role not in ('owner', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 1) Staff (4 штуки) — добавляем только если активных меньше 4
  insert into staff (salon_id, full_name, payout_scheme, payout_percent)
  select p_salon_id, n, 'percent_revenue', 40
  from unnest(array['Анна Демо', 'Мария Демо', 'Ольга Демо', 'Елена Демо']) as n
  where (
    select count(*) from staff
    where salon_id = p_salon_id and is_active = true and deleted_at is null
  ) < 4
  on conflict do nothing;

  select array_agg(id) into v_staff_ids
  from staff where salon_id = p_salon_id and is_active = true and deleted_at is null;

  -- 2) Services (8 штук, разные цены и себестоимости)
  insert into services (salon_id, name, default_price_cents, cost_cents, default_duration_min)
  select p_salon_id, t.name, t.price, t.cost, t.dur
  from (values
    ('Стрижка женская', 12000, 1500, 60),
    ('Стрижка мужская', 8000, 1000, 30),
    ('Окрашивание', 25000, 6000, 120),
    ('Маникюр классический', 9000, 1500, 60),
    ('Маникюр с покрытием', 15000, 3500, 90),
    ('Педикюр', 12000, 2000, 75),
    ('Укладка', 10000, 800, 45),
    ('Лечение волос', 18000, 4500, 60)
  ) as t(name, price, cost, dur)
  where (select count(*) from services where salon_id = p_salon_id and is_archived = false) < 8
  on conflict do nothing;

  select array_agg(id) into v_service_ids
  from services where salon_id = p_salon_id and is_archived = false;

  -- 3) Clients (20 штук)
  insert into clients (salon_id, full_name, phone)
  select p_salon_id, 'Клиент Демо ' || generate_series, '+4860000' || lpad(generate_series::text, 4, '0')
  from generate_series(1, 20)
  where (select count(*) from clients where salon_id = p_salon_id and deleted_at is null) < 20;

  select array_agg(id) into v_client_ids
  from clients where salon_id = p_salon_id and deleted_at is null;

  -- 4) Visits (60 за последние 30 дней). Распределяем равномерно по staff/service/client.
  for i in 1..60 loop
    v_visit_at := now() - (random() * interval '30 days');
    v_amount := (
      select default_price_cents from services where id = v_service_ids[1 + (i % array_length(v_service_ids, 1))]
    );
    insert into visits (
      salon_id, staff_id, service_id, client_id,
      visit_at, amount_cents, payment_method, status
    ) values (
      p_salon_id,
      v_staff_ids[1 + (i % array_length(v_staff_ids, 1))],
      v_service_ids[1 + (i % array_length(v_service_ids, 1))],
      v_client_ids[1 + (i % array_length(v_client_ids, 1))],
      v_visit_at,
      v_amount,
      (array['cash', 'card', 'transfer'])[1 + (i % 3)]::payment_method,
      'paid'
    );
  end loop;

  -- 5) Expenses (10 штук, разные категории). Категории берём первую системную.
  select id into v_category_id
  from expense_categories
  where salon_id = p_salon_id and is_archived = false
  order by sort_order
  limit 1;

  if v_category_id is not null then
    for i in 1..10 loop
      insert into expenses (
        salon_id, category_id, expense_at, amount_cents, payment_method, comment
      ) values (
        p_salon_id,
        v_category_id,
        (now() - (random() * interval '30 days'))::date,
        (5000 + floor(random() * 50000))::int * 100,
        (array['cash', 'card', 'transfer'])[1 + (i % 3)]::payment_method,
        'Демо-расход ' || i
      );
    end loop;
  end if;

  -- Возвращаем счётчики
  select count(*) into v_count_staff from staff where salon_id = p_salon_id and is_active = true and deleted_at is null;
  select count(*) into v_count_services from services where salon_id = p_salon_id and is_archived = false;
  select count(*) into v_count_clients from clients where salon_id = p_salon_id and deleted_at is null;
  select count(*) into v_count_visits from visits where salon_id = p_salon_id and deleted_at is null;
  select count(*) into v_count_expenses from expenses where salon_id = p_salon_id and deleted_at is null;

  return jsonb_build_object(
    'staff', v_count_staff,
    'services', v_count_services,
    'clients', v_count_clients,
    'visits', v_count_visits,
    'expenses', v_count_expenses
  );
end;
$$;

revoke all on function public.seed_demo_data(uuid) from anon;
grant execute on function public.seed_demo_data(uuid) to authenticated;
