-- ============================================================================
-- Bug f0807294 (Elena 05.06): при удалении салона из Settings вылетал toast
-- "[object Object]" — клиент-side handler не распарсил PostgrestError, а
-- сама причина (RLS / триггер / FK) терялась. Чиним двумя ходами:
--   1) на клиенте — централизованный formatError() (см. lib/format-error.ts)
--   2) в БД — собственный RPC soft_delete_salon, который:
--      • явно проверяет, что caller = owner (и кидает понятный текст ошибки)
--      • выполняет soft-delete (deleted_at = now()) атомарно
--      • security definer + search_path — не ломается RLS / поиском
--
-- После этого useDeleteSalon на клиенте бьёт в RPC, ошибки всегда
-- читаемые ("not_owner" / "salon_not_found" / "already_deleted").
-- ============================================================================

create or replace function public.soft_delete_salon(p_salon_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_existing record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_existing
    from public.salons
   where id = p_salon_id;

  if not found then
    raise exception 'salon_not_found' using errcode = 'P0002';
  end if;

  if v_existing.deleted_at is not null then
    -- Идемпотентность: уже soft-deleted — возвращаем тот же id, не падаем.
    return p_salon_id;
  end if;

  select exists (
    select 1
      from public.salon_members
     where salon_id = p_salon_id
       and user_id = v_uid
       and role = 'owner'
  ) into v_is_owner;

  if not v_is_owner then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.salons
     set deleted_at = now()
   where id = p_salon_id;

  return p_salon_id;
end;
$$;

revoke all on function public.soft_delete_salon(uuid) from public;
grant execute on function public.soft_delete_salon(uuid) to authenticated;

comment on function public.soft_delete_salon(uuid) is
  'Soft-delete салона: проверяет owner, ставит deleted_at = now(). Идемпотентно. Ошибки: not_authenticated / salon_not_found / not_owner.';
