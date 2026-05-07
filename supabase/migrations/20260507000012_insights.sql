-- =============================================================================
-- 20260507000012_insights.sql
-- =============================================================================
-- TASK-33: AI-инсайты для салонов. Rules-based проверки + Haiku polish.
--
-- Базовая таблица public.insights уже создана в 20260505000006 (заранее).
-- Здесь только аддитивные изменения: добавляем area + dismissed_at, RLS
-- политики, индекс, RPC агрегатов и cron-инфра.
-- =============================================================================

alter table public.insights
  add column if not exists area text,
  add column if not exists dismissed_at timestamptz;

create index if not exists idx_insights_salon_active
  on public.insights(salon_id, created_at desc)
  where dismissed_at is null;

-- Старую RLS политику переcоздаём явно (split read/update)
drop policy if exists "members access insights" on public.insights;

create policy "members read insights" on public.insights
  for select
  using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create policy "members dismiss own salon insights" on public.insights
  for update
  using (salon_id in (select salon_id from salon_members where user_id = auth.uid()))
  with check (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

grant select, update on public.insights to authenticated;
grant select, insert, update, delete on public.insights to service_role;

-- =============================================================================
-- Cron rendezvous-token (тот же паттерн что у weekly_digest)
-- =============================================================================
create table if not exists public.insight_triggers (
  token       uuid primary key default gen_random_uuid(),
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.insight_triggers enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='insight_triggers'
  ) then
    create policy "no public access to insight_triggers" on public.insight_triggers
      for all using (false) with check (false);
  end if;
end$$;
grant select, insert, update on public.insight_triggers to service_role;

-- =============================================================================
-- process_weekly_insights — кикает edge function для всех салонов
-- =============================================================================
create or replace function public.process_weekly_insights()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  delete from public.insight_triggers where expires_at < now() - interval '1 hour';
  insert into public.insight_triggers default values returning token into v_token;

  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/generate-insights',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('token', v_token::text, 'cron', true)
  );
  return 1;
end;
$$;

revoke all on function public.process_weekly_insights() from public;
grant execute on function public.process_weekly_insights() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'generate-weekly-insights') then
    perform cron.unschedule('generate-weekly-insights');
  end if;
end$$;

-- Понедельник 08:00 UTC — за час до weekly digest, чтобы он мог подцепить
-- свежий top-инсайт.
select cron.schedule(
  'generate-weekly-insights',
  '0 8 * * 1',
  $$ select public.process_weekly_insights(); $$
);

-- =============================================================================
-- RPC: агрегаты салона за 4 недели для rules-engine
-- =============================================================================
create or replace function public.insights_salon_data(
  p_salon_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with
  bounds as (
    select (current_date - interval '28 days')::date as start_date,
           current_date as end_date
  ),
  staff_load as (
    select s.id as staff_id,
           s.full_name,
           count(v.id)::int as visits_4w,
           coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0)::bigint as revenue_4w
      from staff s
      left join visits v
        on v.staff_id = s.id and v.salon_id = s.salon_id
       and v.status = 'paid' and v.deleted_at is null
       and v.visit_at::date >= (select start_date from bounds)
     where s.salon_id = p_salon_id
       and s.is_active = true and s.deleted_at is null
     group by s.id, s.full_name
  ),
  service_use as (
    select sv.id as service_id,
           sv.name,
           sv.default_price_cents,
           count(v.id)::int as visits_30d,
           coalesce(sum(v.amount_cents), 0)::bigint as revenue_30d
      from services sv
      left join visits v
        on v.service_id = sv.id and v.salon_id = sv.salon_id
       and v.status = 'paid' and v.deleted_at is null
       and v.visit_at::date >= (select start_date from bounds)
     where sv.salon_id = p_salon_id
       and sv.is_archived = false
     group by sv.id, sv.name, sv.default_price_cents
  ),
  expense_categories as (
    select c.id, c.name,
           coalesce(sum(e.amount_cents) filter (
             where e.expense_at >= date_trunc('month', current_date)::date
           ), 0)::bigint as current_month,
           coalesce(sum(e.amount_cents) filter (
             where e.expense_at >= (date_trunc('month', current_date) - interval '1 month')::date
               and e.expense_at <  date_trunc('month', current_date)::date
           ), 0)::bigint as prev_month
      from expense_categories c
      left join expenses e
        on e.category_id = c.id and e.salon_id = c.salon_id and e.deleted_at is null
     where c.salon_id = p_salon_id and c.is_archived = false
     group by c.id, c.name
  ),
  lost_vips as (
    select c.id, c.name, c.last_visit_at, c.total_revenue_cents
      from clients c
     where c.salon_id = p_salon_id
       and c.deleted_at is null
       and c.total_revenue_cents > 0
       and c.last_visit_at is not null
       and c.last_visit_at < (current_date - interval '60 days')
     order by c.total_revenue_cents desc
     limit 5
  ),
  cashflow as (
    select coalesce(sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0)::bigint as revenue
      from visits
     where salon_id = p_salon_id
       and status = 'paid' and deleted_at is null
       and visit_at::date >= date_trunc('month', current_date)::date
  ),
  cash_expenses as (
    select coalesce(sum(amount_cents), 0)::bigint as expense
      from expenses
     where salon_id = p_salon_id and deleted_at is null
       and expense_at >= date_trunc('month', current_date)::date
  ),
  salon_meta as (
    select currency, name from salons where id = p_salon_id
  )
  select jsonb_build_object(
    'currency', (select currency from salon_meta),
    'salon_name', (select name from salon_meta),
    'staff', (select coalesce(jsonb_agg(row_to_json(staff_load)), '[]'::jsonb) from staff_load),
    'services', (select coalesce(jsonb_agg(row_to_json(service_use)), '[]'::jsonb) from service_use),
    'expense_categories', (
      select coalesce(jsonb_agg(row_to_json(expense_categories)), '[]'::jsonb) from expense_categories
    ),
    'lost_vips', (select coalesce(jsonb_agg(row_to_json(lost_vips)), '[]'::jsonb) from lost_vips),
    'current_month_revenue', (select revenue from cashflow),
    'current_month_expense', (select expense from cash_expenses)
  );
$$;

grant execute on function public.insights_salon_data(uuid) to authenticated, service_role;
