-- =============================================================================
-- 20260530000002_ai_tool_calls.sql
-- =============================================================================
-- AI tool-use: расширяем ai_messages под tool_calls (Anthropic tool-use API)
-- + добавляем таблицу ai_tool_calls для аудита и undo операций.
--
-- Каждое assistant-сообщение может содержать несколько tool_calls (create_visit,
-- create_expense, transfer_cash, create_client, create_service). Каждый
-- tool_call сохраняется отдельной строкой со ссылкой на созданную сущность
-- через polymorphic entity_type/entity_id — это позволяет:
--   • показывать в UI inline-карточки «✓ Создал визит у Ани на 200 PLN»
--   • дать кнопку «Отменить» (undo → soft-delete сущности)
--   • аудит: кто, когда, через какой prompt создал запись
--
-- Также расширяем ai_salon_snapshot — добавляем staff/services/registers
-- балансы и список проблем (для динамических suggestions).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ai_tool_calls — аудит и undo для tool-use операций
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,

  tool_name text not null,
  -- Параметры, которые LLM передал в tool (JSON, как в Anthropic API).
  tool_input jsonb not null default '{}'::jsonb,

  -- Что получилось. На UI показываем как inline-карточку.
  status text not null check (status in ('success', 'error', 'undone')),
  result_summary text,
  error_message text,

  -- Polymorphic FK на созданную сущность (для undo + детального просмотра).
  entity_type text,  -- 'visit', 'expense', 'cash_transfer', 'client', 'service'
  entity_id uuid,

  -- Если юзер откатил операцию.
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists idx_ai_tool_calls_message
  on public.ai_tool_calls(message_id);
create index if not exists idx_ai_tool_calls_salon_created
  on public.ai_tool_calls(salon_id, created_at desc);
create index if not exists idx_ai_tool_calls_entity
  on public.ai_tool_calls(entity_type, entity_id)
  where entity_type is not null;

alter table public.ai_tool_calls enable row level security;

create policy "members access ai_tool_calls" on public.ai_tool_calls
  for all using (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Расширенный ai_salon_snapshot — добавляем staff/services/registers
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Дополнения:
--   • staff_list — все активные мастера (id, full_name) для tool create_visit
--   • services_list — все активные услуги (id, name, default_price_cents)
--   • cash_registers — список из salons.financial_settings + балансы
--   • expense_categories — для tool create_expense
--   • problems — динамический список проблем для suggestions:
--       - мастера без графика
--       - незакрытый ЗП-период
--       - визиты pending за прошлые даты
--       - клиенты без визита 90+ дней

create or replace function public.ai_salon_snapshot(p_salon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_cur_start timestamptz := date_trunc('month', v_now);
  v_prev_start timestamptz := v_cur_start - interval '1 month';
  v_prev_end   timestamptz := v_cur_start;
  result jsonb;
begin
  with cur_period as (
    select
      coalesce(sum(amount_cents), 0) as revenue,
      count(*) as visits,
      coalesce(avg(amount_cents), 0) as avg_ticket
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and visit_at >= v_cur_start and visit_at < v_now
  ),
  prev_period as (
    select
      coalesce(sum(amount_cents), 0) as revenue,
      count(*) as visits
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and visit_at >= v_prev_start and visit_at < v_prev_end
  ),
  top_staff as (
    select
      coalesce(s.full_name, 'Без мастера') as name,
      sum(v.amount_cents) as revenue,
      count(*) as visits
    from visits v
    left join staff s on s.id = v.staff_id
    where v.salon_id = p_salon_id and v.deleted_at is null
      and v.status = 'paid'
      and v.visit_at >= v_cur_start
    group by 1
    order by revenue desc
    limit 5
  ),
  top_services as (
    select
      coalesce(svc.name, v.service_name_snapshot, '—') as name,
      sum(v.amount_cents) as revenue,
      count(*) as visits
    from visits v
    left join services svc on svc.id = v.service_id
    where v.salon_id = p_salon_id and v.deleted_at is null
      and v.status = 'paid'
      and v.visit_at >= v_cur_start
    group by 1
    order by revenue desc
    limit 5
  ),
  expenses_period as (
    select coalesce(sum(amount_cents), 0) as total
    from expenses
    where salon_id = p_salon_id and deleted_at is null
      and expense_at >= v_cur_start::date and expense_at < v_now::date + 1
  ),
  client_stats as (
    select
      count(*) filter (where last_visit_at >= v_cur_start - interval '90 days') as active,
      count(*) as total,
      count(*) filter (where last_visit_at is null) as never_visited
    from clients
    where salon_id = p_salon_id and deleted_at is null
  ),
  pending_visits as (
    select count(*) as cnt
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'pending'
      and visit_at < v_now
  ),
  staff_list as (
    select id, full_name
    from staff
    where salon_id = p_salon_id and is_active = true and deleted_at is null
    order by full_name
  ),
  services_list as (
    select id, name, default_price_cents, default_duration_min
    from services
    where salon_id = p_salon_id and is_archived = false
    order by name
  ),
  expense_categories_list as (
    select id, name
    from expense_categories
    where salon_id = p_salon_id and is_archived = false
    order by name
  ),
  -- cash registers + актуальные балансы
  cash_registers_list as (
    select
      (elem->>'id')::text as id,
      (elem->>'label')::text as label,
      coalesce(
        (
          select balance_cents
          from public.compute_all_register_balances(p_salon_id) bal
          where bal.register_id = (elem->>'id')::text
        ),
        0
      ) as balance_cents
    from public.salons s,
         jsonb_array_elements(coalesce(s.financial_settings->'cash_registers'->'items', '[]'::jsonb)) elem
    where s.id = p_salon_id
      and coalesce((elem->>'archived')::boolean, false) = false
    order by 1
  ),
  -- Проблемы: для динамических suggestions на главном экране
  problems_data as (
    select jsonb_build_object(
      'staff_without_payout_scheme',
        (select count(*) from staff
         where salon_id = p_salon_id and is_active = true and deleted_at is null
           and payout_percent is null and coalesce(payout_fixed_cents, 0) = 0
           and coalesce(chair_rent_cents, 0) = 0),
      'pending_visits_past',
        (select count(*) from visits
         where salon_id = p_salon_id and deleted_at is null
           and status = 'pending' and visit_at < v_now),
      'clients_inactive_90d',
        (select count(*) from clients
         where salon_id = p_salon_id and deleted_at is null
           and last_visit_at < v_now - interval '90 days'),
      'unpaid_payouts_prev_month',
        (select count(*) from payouts
         where salon_id = p_salon_id and status = 'draft'
           and period_end < v_cur_start::date),
      'expenses_no_category_count',
        (select count(*) from expenses
         where salon_id = p_salon_id and deleted_at is null
           and category_id is null
           and expense_at >= (v_now - interval '30 days')::date)
    ) as data
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'current_month_start', v_cur_start,
      'now', v_now
    ),
    'current_month', (select to_jsonb(cur_period) from cur_period),
    'prev_month', (select to_jsonb(prev_period) from prev_period),
    'top_staff', (select coalesce(jsonb_agg(to_jsonb(top_staff)), '[]'::jsonb) from top_staff),
    'top_services', (select coalesce(jsonb_agg(to_jsonb(top_services)), '[]'::jsonb) from top_services),
    'expenses_current_month_cents', (select total from expenses_period),
    'clients', (select to_jsonb(client_stats) from client_stats),
    'pending_unbilled_past', (select cnt from pending_visits),
    'staff_list', (select coalesce(jsonb_agg(to_jsonb(staff_list)), '[]'::jsonb) from staff_list),
    'services_list', (select coalesce(jsonb_agg(to_jsonb(services_list)), '[]'::jsonb) from services_list),
    'expense_categories', (select coalesce(jsonb_agg(to_jsonb(expense_categories_list)), '[]'::jsonb) from expense_categories_list),
    'cash_registers', (select coalesce(jsonb_agg(to_jsonb(cash_registers_list)), '[]'::jsonb) from cash_registers_list),
    'problems', (select data from problems_data)
  ) into result;

  return result;
end;
$$;

revoke all on function public.ai_salon_snapshot(uuid) from public;
grant execute on function public.ai_salon_snapshot(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: ai_create_visit
-- ─────────────────────────────────────────────────────────────────────────────
-- AI-помощник вызывает этот RPC через service_role когда юзер сказал
-- «у Ани сегодня клиент оплатил 200 PLN наличными».
--
-- Проверяем что caller (через service_role + p_user_id) — owner/admin салона.
-- Также все FK (staff_id/client_id/service_id) принадлежат тому же салону.

create or replace function public.ai_create_visit(
  p_user_id uuid,
  p_salon_id uuid,
  p_staff_id uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_amount_cents bigint,
  p_payment_method text,
  p_visit_at timestamptz,
  p_comment text default null
)
returns public.visits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.visits;
  v_method payment_method;
begin
  -- Permissions: owner/admin only (write actions)
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  -- Validate payment_method
  begin
    v_method := p_payment_method::payment_method;
  exception when others then
    raise exception 'invalid payment_method: %', p_payment_method using errcode = '22023';
  end;

  -- Cross-salon validation
  if p_staff_id is not null and not exists (
    select 1 from public.staff where id = p_staff_id and salon_id = p_salon_id
  ) then
    raise exception 'staff not in salon' using errcode = '22023';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients where id = p_client_id and salon_id = p_salon_id
  ) then
    raise exception 'client not in salon' using errcode = '22023';
  end if;
  if p_service_id is not null and not exists (
    select 1 from public.services where id = p_service_id and salon_id = p_salon_id
  ) then
    raise exception 'service not in salon' using errcode = '22023';
  end if;

  insert into public.visits (
    salon_id, staff_id, client_id, service_id,
    visit_at, amount_cents, payment_method, status,
    comment, source, created_by
  ) values (
    p_salon_id, p_staff_id, p_client_id, p_service_id,
    coalesce(p_visit_at, now()), p_amount_cents, v_method, 'paid',
    p_comment, 'ai_assistant', p_user_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ai_create_visit(uuid, uuid, uuid, uuid, uuid, bigint, text, timestamptz, text) from public;
grant execute on function public.ai_create_visit(uuid, uuid, uuid, uuid, uuid, bigint, text, timestamptz, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: ai_create_expense
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ai_create_expense(
  p_user_id uuid,
  p_salon_id uuid,
  p_category_id uuid,
  p_amount_cents bigint,
  p_expense_at date,
  p_comment text default null,
  p_contractor_name text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.expenses;
begin
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.expense_categories
    where id = p_category_id and salon_id = p_salon_id
  ) then
    raise exception 'category not in salon' using errcode = '22023';
  end if;

  insert into public.expenses (
    salon_id, category_id, expense_at, amount_cents,
    comment, contractor_name, source, created_by
  ) values (
    p_salon_id, p_category_id, coalesce(p_expense_at, current_date), p_amount_cents,
    p_comment, p_contractor_name, 'ai_assistant', p_user_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ai_create_expense(uuid, uuid, uuid, bigint, date, text, text) from public;
grant execute on function public.ai_create_expense(uuid, uuid, uuid, bigint, date, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: ai_create_client
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ai_create_client(
  p_user_id uuid,
  p_salon_id uuid,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_notes text default null
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.clients;
begin
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name required' using errcode = '22023';
  end if;

  insert into public.clients (salon_id, name, phone, email, notes, source)
  values (p_salon_id, trim(p_name), p_phone, p_email, p_notes, 'ai_assistant')
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ai_create_client(uuid, uuid, text, text, text, text) from public;
grant execute on function public.ai_create_client(uuid, uuid, text, text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC: ai_create_service
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ai_create_service(
  p_user_id uuid,
  p_salon_id uuid,
  p_name text,
  p_default_price_cents bigint,
  p_default_duration_min int default null,
  p_category_id uuid default null
)
returns public.services
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.services;
begin
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name required' using errcode = '22023';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.service_categories
    where id = p_category_id and salon_id = p_salon_id
  ) then
    raise exception 'category not in salon' using errcode = '22023';
  end if;

  insert into public.services (
    salon_id, category_id, name, default_price_cents, default_duration_min
  ) values (
    p_salon_id, p_category_id, trim(p_name),
    coalesce(p_default_price_cents, 0), p_default_duration_min
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ai_create_service(uuid, uuid, text, bigint, int, uuid) from public;
grant execute on function public.ai_create_service(uuid, uuid, text, bigint, int, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: ai_transfer_cash
-- ─────────────────────────────────────────────────────────────────────────────
-- Обёртка над cash_transfer_create, но принимает p_user_id (для service_role
-- вызова из edge function) и явно валидирует owner/admin.

create or replace function public.ai_transfer_cash(
  p_user_id uuid,
  p_salon_id uuid,
  p_from text,
  p_to text,
  p_amount_cents bigint,
  p_comment text default null
)
returns public.cash_transfers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance bigint;
  v_at timestamptz := now();
  v_row public.cash_transfers;
begin
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or length(p_from) = 0 or length(p_to) = 0 then
    raise exception 'from/to required' using errcode = '22023';
  end if;
  if p_from = p_to then
    raise exception 'from and to must differ' using errcode = '22023';
  end if;

  -- Проверка баланса источника. compute_register_balance вернёт null если
  -- caller (service_role) не имеет членства через auth.uid() — но мы прошли
  -- проверку выше через p_user_id, поэтому считаем баланс вручную без auth.
  select coalesce(sum(case when status = 'paid' then amount_cents - discount_cents + tip_cents else 0 end), 0)
    into v_balance
  from public.visits
  where salon_id = p_salon_id and cash_register_id = p_from
    and deleted_at is null and visit_at <= v_at;

  v_balance := v_balance + coalesce((
    select sum(amount_cents) from public.other_incomes
    where salon_id = p_salon_id and cash_register_id = p_from
      and deleted_at is null and income_at <= v_at::date
  ), 0);

  v_balance := v_balance + coalesce((
    select sum(amount_cents) from public.cash_transfers
    where salon_id = p_salon_id and to_register_id = p_from
      and deleted_at is null and transferred_at <= v_at
  ), 0);

  v_balance := v_balance - coalesce((
    select sum(amount_cents) from public.expenses
    where salon_id = p_salon_id and cash_register_id = p_from
      and deleted_at is null and expense_at <= v_at::date
  ), 0);

  v_balance := v_balance - coalesce((
    select sum(net_payout_cents) from public.payouts
    where salon_id = p_salon_id and cash_register_id = p_from
      and status = 'paid'
  ), 0);

  v_balance := v_balance - coalesce((
    select sum(amount_cents) from public.cash_transfers
    where salon_id = p_salon_id and from_register_id = p_from
      and deleted_at is null and transferred_at <= v_at
  ), 0);

  if v_balance < p_amount_cents then
    raise exception 'insufficient balance in source register: % < %', v_balance, p_amount_cents
      using errcode = '23514';
  end if;

  insert into public.cash_transfers (
    salon_id, from_register_id, to_register_id,
    amount_cents, comment, transferred_at, created_by
  ) values (
    p_salon_id, p_from, p_to,
    p_amount_cents, p_comment, v_at, p_user_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ai_transfer_cash(uuid, uuid, text, text, bigint, text) from public;
grant execute on function public.ai_transfer_cash(uuid, uuid, text, text, bigint, text) to service_role;
