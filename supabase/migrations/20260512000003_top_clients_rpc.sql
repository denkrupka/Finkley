-- =============================================================================
-- 20260512000003_top_clients_rpc.sql
-- =============================================================================
-- TASK-61: топ клиентов по выручке за период. Используется в /reports?tab=clients.
--
-- Источник — visits с client_id (visits.client_id может быть null для walk-in).
-- Не учитываем cancelled и deleted.
-- =============================================================================

create or replace function public.top_clients_by_revenue(
  p_salon_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_limit int default 20
) returns table (
  client_id uuid,
  full_name text,
  phone text,
  email text,
  visit_count bigint,
  revenue_cents bigint,
  last_visit_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id as client_id,
    c.name as full_name,
    c.phone,
    c.email,
    count(v.id)::bigint as visit_count,
    sum(
      coalesce(v.amount_cents, 0)
      - coalesce(v.discount_cents, 0)
      + coalesce(v.tip_cents, 0)
    )::bigint as revenue_cents,
    max(v.visit_at) as last_visit_at
  from public.visits v
  join public.clients c on c.id = v.client_id and c.salon_id = v.salon_id
  where v.salon_id = p_salon_id
    and v.deleted_at is null
    and v.status <> 'cancelled'
    and v.visit_at >= p_start
    and v.visit_at < p_end
    and v.client_id is not null
  group by c.id, c.name, c.phone, c.email
  order by revenue_cents desc nulls last
  limit p_limit;
$$;

revoke all on function public.top_clients_by_revenue(uuid, timestamptz, timestamptz, int)
  from public;
grant execute on function public.top_clients_by_revenue(uuid, timestamptz, timestamptz, int)
  to authenticated;
