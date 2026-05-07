-- AI-помощник: чат с владельцем салона. На каждый салон одна активная
-- conversation; юзер может «начать новую» (старая остаётся в истории, но
-- список conversations пока в UI не отображаем — слишком сложно для MVP).
--
-- Edge function `ai-assistant` принимает {message, salon_id}, собирает
-- snapshot бизнес-метрик из БД, шлёт в Claude haiku 4.5, ответ и user-msg
-- сохраняет в ai_messages.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  title text not null default 'Новая беседа',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_conversations_salon
  on public.ai_conversations(salon_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- usage info из anthropic для биллинга/аналитики
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_messages_conv
  on public.ai_messages(conversation_id, created_at);

-- RLS: видим только свои conversations через salon_members
alter table public.ai_conversations enable row level security;
create policy "members access ai_conversations" on public.ai_conversations
  for all using (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  );

alter table public.ai_messages enable row level security;
create policy "members access ai_messages" on public.ai_messages
  for all using (
    conversation_id in (
      select id from ai_conversations
      where salon_id in (select salon_id from salon_members where user_id = auth.uid())
    )
  );

create trigger trg_ai_conversations_updated_at
  before update on ai_conversations
  for each row execute procedure public.set_updated_at();

-- Helper RPC: snapshot KPI салона за последние 30/60 дней для контекста AI.
-- Security definer — позволяем edge function вызвать (через service_role)
-- без RLS на промежуточные таблицы, salon_id мы валидируем через auth.uid()
-- внутри edge function отдельно.
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
      and incurred_at >= v_cur_start::date and incurred_at < v_now::date + 1
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
    'pending_unbilled_past', (select cnt from pending_visits)
  ) into result;

  return result;
end;
$$;

revoke all on function public.ai_salon_snapshot(uuid) from public;
grant execute on function public.ai_salon_snapshot(uuid) to authenticated, service_role;
