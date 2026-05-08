-- iCal feed tokens + month forecast RPC.

-- =============================================================================
-- iCal-фид: юзер генерит уникальный токен, добавляет URL в Google/Apple
-- Calendar/Outlook — те периодически пуллят. Чтобы не светить salon_id +
-- service-role ключ, у нас уникальный непредсказуемый токен на пару user-salon.
-- =============================================================================
create table if not exists public.calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, salon_id)
);

create index if not exists idx_calendar_feed_token on public.calendar_feed_tokens(token);

alter table public.calendar_feed_tokens enable row level security;

create policy "own calendar tokens" on public.calendar_feed_tokens for all using (
  user_id = auth.uid()
) with check (user_id = auth.uid());

grant select, insert, update, delete on public.calendar_feed_tokens to authenticated;
grant all on public.calendar_feed_tokens to service_role;

-- RPC: получить или создать токен для текущего юзера и салона. Идемпотентно.
create or replace function public.get_or_create_calendar_token(p_salon_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_token text;
begin
  if v_user is null then raise exception 'auth_required'; end if;
  if not exists (
    select 1 from public.salon_members where salon_id = p_salon_id and user_id = v_user
  ) then raise exception 'not_a_member'; end if;

  select token into v_token from public.calendar_feed_tokens
    where user_id = v_user and salon_id = p_salon_id and revoked_at is null;
  if v_token is not null then return v_token; end if;

  -- Генерим 32-байтный random base64url
  v_token := replace(replace(replace(
    encode(gen_random_bytes(24), 'base64'),
    '+', '-'), '/', '_'), '=', '');

  insert into public.calendar_feed_tokens(user_id, salon_id, token)
  values (v_user, p_salon_id, v_token);

  return v_token;
end;
$$;

revoke all on function public.get_or_create_calendar_token(uuid) from public, anon;
grant execute on function public.get_or_create_calendar_token(uuid) to authenticated, service_role;

create or replace function public.revoke_calendar_token(p_salon_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'auth_required'; end if;
  update public.calendar_feed_tokens
    set revoked_at = now()
    where user_id = v_user and salon_id = p_salon_id and revoked_at is null;
  return true;
end;
$$;

revoke all on function public.revoke_calendar_token(uuid) from public, anon;
grant execute on function public.revoke_calendar_token(uuid) to authenticated, service_role;

-- =============================================================================
-- Прогноз месяца: revenue_so_far / days_passed * days_total
-- Учитываем pending (предстоящие подтверждённые) визиты как "почти-выручка"
-- если они в текущем месяце.
-- =============================================================================
create or replace function public.month_forecast(p_salon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now);
  v_month_end timestamptz := v_month_start + interval '1 month';
  v_days_passed numeric := extract(day from v_now);
  v_days_total numeric := extract(day from (v_month_end - interval '1 day'));
  v_revenue_so_far bigint;
  v_pending_in_month bigint;
  v_prev_month_revenue bigint;
  v_forecast bigint;
  v_avg_daily numeric;
begin
  if v_user is null then raise exception 'auth_required'; end if;
  if not exists (
    select 1 from public.salon_members where salon_id = p_salon_id and user_id = v_user
  ) then raise exception 'not_a_member'; end if;

  select coalesce(sum(amount_cents - discount_cents + tip_cents), 0) into v_revenue_so_far
    from public.visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and visit_at >= v_month_start and visit_at < v_now;

  -- Pending в этом месяце (будущие подтверждённые) — мягкий индикатор
  select coalesce(sum(amount_cents), 0) into v_pending_in_month
    from public.visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'pending'
      and visit_at >= v_now and visit_at < v_month_end;

  select coalesce(sum(amount_cents - discount_cents + tip_cents), 0) into v_prev_month_revenue
    from public.visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and visit_at >= (v_month_start - interval '1 month')
      and visit_at < v_month_start;

  -- Linear forecast: avg_daily * days_total. Pending учитываем поверх.
  v_avg_daily := case when v_days_passed > 0 then v_revenue_so_far::numeric / v_days_passed else 0 end;
  v_forecast := round(v_avg_daily * v_days_total) + v_pending_in_month;

  return jsonb_build_object(
    'revenue_so_far', v_revenue_so_far,
    'pending_in_month', v_pending_in_month,
    'forecast', v_forecast,
    'prev_month_revenue', v_prev_month_revenue,
    'days_passed', v_days_passed,
    'days_total', v_days_total,
    'vs_prev_month_pct', case
      when v_prev_month_revenue > 0
        then round((v_forecast - v_prev_month_revenue)::numeric / v_prev_month_revenue * 100)
      else null
    end
  );
end;
$$;

revoke all on function public.month_forecast(uuid) from public, anon;
grant execute on function public.month_forecast(uuid) to authenticated, service_role;
