-- =============================================================================
-- 20260507000005_payouts_calc.sql
-- =============================================================================
-- TASK-22: расчёт зарплат и закрытие периода.
--
-- 1) calculate_payouts_for_period(salon, period_start, period_end)
--    Read-only RPC: для каждой schemы выплат считает payout мастера за период.
--    Никаких записей в БД — только превью для UI.
--
-- 2) close_payout_period(salon, period_start, period_end)
--    Write RPC: создаёт строки в payouts (status='paid') + auto-expense в
--    категории "Зарплаты" (создаётся на лету если её нет). Возвращает summary.
--    Идемпотентность через unique-индекс на (salon_id, staff_id, period_start, period_end).
-- =============================================================================

-- Уникальный индекс: один payout на мастера-период (страховка от двойного закрытия)
create unique index if not exists ux_payouts_salon_staff_period
  on public.payouts(salon_id, staff_id, period_start, period_end);

create index if not exists idx_payouts_salon_period
  on public.payouts(salon_id, period_start desc);

-- =============================================================================
-- calculate_payouts_for_period — чистая read-only функция, превью для UI
-- =============================================================================
create or replace function public.calculate_payouts_for_period(
  p_salon_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  staff_id uuid,
  full_name text,
  payout_scheme staff_payout_scheme,
  visit_count bigint,
  revenue_cents bigint,
  payout_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with staff_revenue as (
    select s.id                       as staff_id,
           s.full_name,
           s.payout_scheme,
           s.payout_percent,
           s.payout_fixed_cents,
           s.chair_rent_cents,
           coalesce(
             sum(v.amount_cents + v.tip_cents - v.discount_cents),
             0
           )::bigint                  as revenue_cents,
           count(v.id)::bigint        as visit_count
      from staff s
      left join visits v
        on v.staff_id = s.id
       and v.salon_id = s.salon_id
       and v.status   = 'paid'
       and v.deleted_at is null
       and v.visit_at >= p_period_start::timestamptz
       and v.visit_at <  (p_period_end::date + 1)::timestamptz
     where s.salon_id = p_salon_id
       and s.deleted_at is null
       and s.is_active = true
     group by s.id
  ),
  service_overrides as (
    select v.staff_id,
           coalesce(
             sum(((v.amount_cents + v.tip_cents - v.discount_cents) * o.payout_percent)::bigint / 100),
             0
           )::bigint as override_payout
      from visits v
      join staff_service_overrides o
        on o.staff_id   = v.staff_id
       and o.service_id = v.service_id
      join staff s on s.id = v.staff_id
     where v.salon_id = p_salon_id
       and s.payout_scheme = 'percent_service'
       and v.status = 'paid'
       and v.deleted_at is null
       and v.visit_at >= p_period_start::timestamptz
       and v.visit_at <  (p_period_end::date + 1)::timestamptz
     group by v.staff_id
  )
  select sr.staff_id,
         sr.full_name,
         sr.payout_scheme,
         sr.visit_count,
         sr.revenue_cents,
         (case sr.payout_scheme
            when 'fixed'           then coalesce(sr.payout_fixed_cents, 0)
            when 'percent_revenue' then (sr.revenue_cents * coalesce(sr.payout_percent, 0))::bigint / 100
            when 'percent_service' then coalesce(so.override_payout, 0)
            when 'chair_rent'      then -coalesce(sr.chair_rent_cents, 0)
            when 'mixed'           then coalesce(sr.payout_fixed_cents, 0)
                                         + (sr.revenue_cents * coalesce(sr.payout_percent, 0))::bigint / 100
          end)::bigint as payout_cents
    from staff_revenue sr
    left join service_overrides so on so.staff_id = sr.staff_id
   order by sr.full_name;
$$;

grant execute on function public.calculate_payouts_for_period(uuid, date, date) to authenticated;

-- =============================================================================
-- close_payout_period — атомарная запись payouts + auto-expense за зарплаты
-- =============================================================================
create or replace function public.close_payout_period(
  p_salon_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  payouts_created int,
  total_expense_cents bigint
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r record;
  v_expense_id uuid;
  v_category_id uuid;
  v_total bigint := 0;
  v_count int := 0;
  v_period_label text;
begin
  -- Membership check (RLS дублирует, но явно — лучше)
  if not exists (
    select 1 from salon_members
     where salon_id = p_salon_id and user_id = auth.uid()
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Период не должен быть в будущем (нечего закрывать)
  if p_period_end >= current_date then
    raise exception 'period_not_finished' using errcode = '22023';
  end if;

  -- Запретить двойное закрытие — за это отвечает unique-индекс ux_payouts_salon_staff_period
  if exists (
    select 1 from payouts
     where salon_id = p_salon_id
       and period_start = p_period_start
       and period_end = p_period_end
       and status = 'paid'
  ) then
    raise exception 'period_already_closed' using errcode = '23505';
  end if;

  -- Найти/создать категорию "Зарплаты" (системная, чтобы юзер не мог удалить)
  select id into v_category_id
    from expense_categories
   where salon_id = p_salon_id
     and is_system = true
     and name = 'Зарплаты'
   limit 1;

  if v_category_id is null then
    insert into expense_categories (salon_id, name, is_system, sort_order)
      values (p_salon_id, 'Зарплаты', true, 100)
      returning id into v_category_id;
  end if;

  v_period_label := to_char(p_period_start, 'DD.MM.YYYY') || ' — ' || to_char(p_period_end, 'DD.MM.YYYY');

  for r in
    select * from public.calculate_payouts_for_period(p_salon_id, p_period_start, p_period_end)
  loop
    v_expense_id := null;

    -- Auto-expense создаём только для положительных выплат
    -- (chair_rent даёт отрицательный payout — это доход, не расход; владелец логирует вручную)
    if r.payout_cents > 0 then
      insert into expenses (
        salon_id, category_id, expense_at, amount_cents,
        comment, source, created_by
      )
      values (
        p_salon_id, v_category_id, p_period_end, r.payout_cents,
        'Зарплата: ' || r.full_name || ' (' || v_period_label || ')',
        'payout',
        auth.uid()
      )
      returning id into v_expense_id;
      v_total := v_total + r.payout_cents;
    end if;

    insert into payouts (
      salon_id, staff_id, period_start, period_end,
      total_revenue_cents, total_payout_cents, net_payout_cents,
      status, paid_at, comment
    ) values (
      p_salon_id, r.staff_id, p_period_start, p_period_end,
      r.revenue_cents, r.payout_cents, r.payout_cents,
      'paid', now(),
      case when v_expense_id is not null
           then 'expense_id=' || v_expense_id::text
           else null
      end
    );

    v_count := v_count + 1;
  end loop;

  return query select v_count, v_total;
end;
$$;

grant execute on function public.close_payout_period(uuid, date, date) to authenticated;
