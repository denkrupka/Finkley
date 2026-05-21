-- =============================================================================
-- 20260521000018_staff_tips_summary.sql
-- =============================================================================
-- RPC для подвкладки /reports → мастера → Чаевые.
-- Возвращает per-staff агрегаты по чаевым за период: сумма, кол-во визитов
-- с чаевыми, средний размер чаевых на визит, доля чаевых от выручки мастера.
-- =============================================================================

create or replace function public.staff_tips_summary(
  p_salon_id uuid,
  p_start_ts timestamptz,
  p_end_ts   timestamptz
)
returns table (
  staff_id uuid,
  full_name text,
  is_active boolean,
  tips_cents bigint,
  tipped_visits_count int,
  visits_count int,
  avg_tip_cents bigint,
  visits_revenue_cents bigint,
  tip_share_pct numeric
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from salon_members sm
     where sm.salon_id = p_salon_id and sm.user_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;

  return query
  with v as (
    select
      vi.staff_id,
      vi.tip_cents,
      vi.amount_cents - vi.discount_cents as net_no_tip_cents
    from visits vi
    where vi.salon_id = p_salon_id
      and vi.status = 'paid'
      and vi.kind = 'visit'
      and vi.visit_at >= p_start_ts
      and vi.visit_at <  p_end_ts
      and vi.staff_id is not null
  ),
  agg as (
    select
      st.id as staff_id,
      st.full_name,
      st.is_active,
      coalesce(sum(v.tip_cents), 0)::bigint as tips_cents,
      coalesce(count(case when v.tip_cents > 0 then 1 end), 0)::int as tipped_visits_count,
      coalesce(count(v.staff_id), 0)::int as visits_count,
      coalesce(sum(v.net_no_tip_cents), 0)::bigint as visits_revenue_cents
    from staff st
      left join v on v.staff_id = st.id
    where st.salon_id = p_salon_id
    group by st.id, st.full_name, st.is_active
  )
  select
    a.staff_id,
    a.full_name,
    a.is_active,
    a.tips_cents,
    a.tipped_visits_count,
    a.visits_count,
    case when a.tipped_visits_count > 0
      then (a.tips_cents / a.tipped_visits_count)::bigint
      else 0::bigint
    end as avg_tip_cents,
    a.visits_revenue_cents,
    case when a.visits_revenue_cents > 0
      then round((a.tips_cents::numeric * 100) / a.visits_revenue_cents, 2)
      else 0::numeric
    end as tip_share_pct
  from agg a
  order by a.tips_cents desc;
end;
$$;

grant execute on function public.staff_tips_summary(uuid, timestamptz, timestamptz)
  to authenticated;

comment on function public.staff_tips_summary is
  'Per-staff агрегаты по чаевым (paid kind=visit). Для /reports → мастера → Чаевые.';
