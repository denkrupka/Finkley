-- =============================================================================
-- 20260515000002_audit_log_rpc.sql
-- =============================================================================
-- RPC list_salon_audit — owner/admin салона может получить audit_log записи
-- с именем/email автора. Поддерживает фильтры: date range, action prefix.
-- =============================================================================

create or replace function public.list_salon_audit(
  p_salon_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_action_prefix text default null,
  p_limit int default 500
)
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  user_full_name text,
  action text,
  entity_type text,
  entity_id text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.salon_members
     where salon_id = p_salon_id
       and user_id = auth.uid()
       and role in ('owner','admin')
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    a.id,
    a.user_id,
    u.email as user_email,
    p.full_name as user_full_name,
    a.action,
    a.entity_type,
    a.entity_id,
    a.payload,
    a.created_at
  from public.audit_log a
  left join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  where a.salon_id = p_salon_id
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at <= p_to)
    and (p_action_prefix is null or a.action like p_action_prefix || '%')
  order by a.created_at desc
  limit greatest(1, least(2000, p_limit));
end;
$$;

revoke all on function public.list_salon_audit(uuid, timestamptz, timestamptz, text, int) from public, anon;
grant execute on function public.list_salon_audit(uuid, timestamptz, timestamptz, text, int) to authenticated, service_role;
