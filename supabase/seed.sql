-- =============================================================================
-- supabase/seed.sql
-- =============================================================================
-- Тестовые данные для локальной разработки (supabase db reset).
-- НЕ применяется к staging/production.
--
-- Создаёт:
--   - 1 тестовый юзер (test@finkley.local / password: testpassword123)
--   - 1 тестовый салон "Тестовая Студия" в Польше
--   - 3 мастера
--   - 6 категорий услуг + 12 услуг
--   - 7 дефолтных категорий расходов
--   - 5 клиентов
--   - 30 визитов за последние 30 дней
--   - 15 расходов за последние 30 дней
--
-- Назначение:
--   1. Чтобы Claude Code сразу видел работу UI с данными
--   2. Чтобы можно было локально протестировать дашборд
--   3. Для разработки фич без ручного ввода
-- =============================================================================

-- Тестовый юзер (через auth.admin API эквивалент в SQL)
-- ⚠ Этот блок работает только на локальном supabase start, не на проде.
do $$
declare
  test_user_id uuid := '00000000-0000-0000-0000-000000000001';
  test_salon_id uuid := '11111111-1111-1111-1111-111111111111';
  staff_anna uuid := '22222222-2222-2222-2222-000000000001';
  staff_masha uuid := '22222222-2222-2222-2222-000000000002';
  staff_lena uuid := '22222222-2222-2222-2222-000000000003';
  cat_haircut uuid := '33333333-3333-3333-3333-000000000001';
  cat_color uuid := '33333333-3333-3333-3333-000000000002';
  cat_style uuid := '33333333-3333-3333-3333-000000000003';
  svc_haircut_woman uuid := '44444444-4444-4444-4444-000000000001';
  svc_haircut_man uuid := '44444444-4444-4444-4444-000000000002';
  svc_color_full uuid := '44444444-4444-4444-4444-000000000003';
  svc_color_root uuid := '44444444-4444-4444-4444-000000000004';
  svc_blowdry uuid := '44444444-4444-4444-4444-000000000005';
  svc_styling uuid := '44444444-4444-4444-4444-000000000006';
  exp_cat_rent uuid := '55555555-5555-5555-5555-000000000001';
  exp_cat_supplies uuid := '55555555-5555-5555-5555-000000000002';
  exp_cat_marketing uuid := '55555555-5555-5555-5555-000000000003';
  exp_cat_utilities uuid := '55555555-5555-5555-5555-000000000004';
  exp_cat_other uuid := '55555555-5555-5555-5555-000000000005';
  client_olga uuid := '66666666-6666-6666-6666-000000000001';
  client_marta uuid := '66666666-6666-6666-6666-000000000002';
  client_kasia uuid := '66666666-6666-6666-6666-000000000003';
  i int;
  random_staff uuid;
  random_service uuid;
  random_amount bigint;
  random_payment payment_method;
  random_client uuid;
  visit_date timestamptz;
begin
  -- Создаём тестового юзера в auth.users
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    test_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'test@finkley.local',
    crypt('testpassword123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Тестовый Пользователь"}',
    now(),
    now(),
    '', '', '', ''
  ) on conflict (id) do nothing;

  -- profile создаётся через триггер handle_new_user
  -- Принудительно обновим locale на ru если триггер не сработал
  update profiles set locale = 'ru', full_name = 'Тестовый Пользователь' where id = test_user_id;

  -- Создаём тестовый салон
  insert into salons (
    id, name, country_code, currency, timezone, salon_type, locale, created_by
  ) values (
    test_salon_id,
    'Тестовая Студия',
    'PL', 'PLN', 'Europe/Warsaw', 'hair', 'ru',
    test_user_id
  ) on conflict (id) do nothing;

  -- Owner membership
  insert into salon_members (salon_id, user_id, role)
  values (test_salon_id, test_user_id, 'owner')
  on conflict (salon_id, user_id) do nothing;

  -- Категории услуг
  insert into service_categories (id, salon_id, name, sort_order) values
    (cat_haircut, test_salon_id, 'Стрижка', 1),
    (cat_color, test_salon_id, 'Окрашивание', 2),
    (cat_style, test_salon_id, 'Укладка', 3)
  on conflict (id) do nothing;

  -- Услуги
  insert into services (id, salon_id, category_id, name, default_price_cents, default_duration_min) values
    (svc_haircut_woman, test_salon_id, cat_haircut, 'Стрижка женская', 12000, 60),
    (svc_haircut_man, test_salon_id, cat_haircut, 'Стрижка мужская', 8000, 45),
    (svc_color_full, test_salon_id, cat_color, 'Окрашивание полное', 25000, 120),
    (svc_color_root, test_salon_id, cat_color, 'Окрашивание корней', 15000, 90),
    (svc_blowdry, test_salon_id, cat_style, 'Укладка', 6000, 45),
    (svc_styling, test_salon_id, cat_style, 'Вечерняя укладка', 12000, 60)
  on conflict (id) do nothing;

  -- Мастера
  insert into staff (id, salon_id, full_name, payout_scheme, payout_percent, display_color) values
    (staff_anna, test_salon_id, 'Анна', 'percent_revenue', 50.00, '#10b981'),
    (staff_masha, test_salon_id, 'Маша', 'percent_revenue', 45.00, '#3b82f6'),
    (staff_lena, test_salon_id, 'Лена', 'percent_revenue', 40.00, '#f59e0b')
  on conflict (id) do nothing;

  -- Категории расходов
  insert into expense_categories (id, salon_id, name, is_system, sort_order) values
    (exp_cat_rent, test_salon_id, 'Аренда', true, 1),
    (exp_cat_supplies, test_salon_id, 'Материалы', true, 2),
    (exp_cat_marketing, test_salon_id, 'Реклама', true, 3),
    (exp_cat_utilities, test_salon_id, 'Коммунальные услуги', true, 4),
    (exp_cat_other, test_salon_id, 'Прочее', true, 5)
  on conflict (id) do nothing;

  -- Клиенты
  insert into clients (id, salon_id, name, phone, source) values
    (client_olga, test_salon_id, 'Ольга К.', '+48 600 100 001', 'instagram'),
    (client_marta, test_salon_id, 'Marta W.', '+48 600 100 002', 'walk-in'),
    (client_kasia, test_salon_id, 'Kasia P.', '+48 600 100 003', 'referral')
  on conflict (id) do nothing;

  -- Генерим 30 визитов за последние 30 дней
  for i in 1..30 loop
    -- Случайный мастер
    random_staff := (array[staff_anna, staff_masha, staff_lena])[1 + floor(random() * 3)::int];
    -- Случайная услуга
    random_service := (array[svc_haircut_woman, svc_haircut_man, svc_color_full, svc_color_root, svc_blowdry, svc_styling])[1 + floor(random() * 6)::int];
    -- Случайная сумма (8000-25000 копеек = 80-250 PLN)
    random_amount := 8000 + floor(random() * 17000)::bigint;
    -- Случайный способ оплаты
    random_payment := (array['cash', 'card', 'transfer']::payment_method[])[1 + floor(random() * 3)::int];
    -- Иногда привязываем клиента (50% случаев)
    random_client := case when random() > 0.5
      then (array[client_olga, client_marta, client_kasia])[1 + floor(random() * 3)::int]
      else null end;
    -- Дата визита
    visit_date := now() - (random() * interval '30 days');

    insert into visits (
      salon_id, staff_id, client_id, service_id,
      visit_at, amount_cents, payment_method, status,
      source, created_by
    ) values (
      test_salon_id, random_staff, random_client, random_service,
      visit_date, random_amount, random_payment, 'paid',
      'manual', test_user_id
    );
  end loop;

  -- Генерим 15 расходов за последние 30 дней
  for i in 1..15 loop
    insert into expenses (
      salon_id, category_id, expense_at, amount_cents,
      payment_method, comment, source, created_by
    ) values (
      test_salon_id,
      (array[exp_cat_rent, exp_cat_supplies, exp_cat_marketing, exp_cat_utilities, exp_cat_other])[1 + floor(random() * 5)::int],
      (now() - (random() * interval '30 days'))::date,
      5000 + floor(random() * 50000)::bigint,
      'card'::payment_method,
      case (i % 4)
        when 0 then 'Аренда зала'
        when 1 then 'Закупка краски'
        when 2 then 'Реклама в Инстаграм'
        else null
      end,
      'manual',
      test_user_id
    );
  end loop;

  raise notice 'Seed данные загружены. Логин: test@finkley.local / testpassword123';
end $$;
