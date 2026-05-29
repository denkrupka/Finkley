-- ADR-030 — Cleanup RPC для brown салонов.
-- Brown = salon с onboarding_completed_at IS NULL старше 7 дней.
-- Запускается ежедневно через pg_cron (владелец настраивает отдельно).
--
-- Каскадно удаляются связанные строки через ON DELETE CASCADE
-- (salon_members, staff, services, expense_categories, salon_integrations
-- и т.д. — установлено в исходных миграциях).

create or replace function public.cleanup_brown_salons()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  with deleted as (
    delete from public.salons
    where onboarding_completed_at is null
      and created_at < now() - interval '7 days'
    returning id
  )
  select count(*)::int into v_deleted from deleted;

  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.cleanup_brown_salons() from public;
grant execute on function public.cleanup_brown_salons() to service_role;

comment on function public.cleanup_brown_salons() is
  'Удаляет brown салоны (onboarding_completed_at IS NULL >7 дней). '
  'Запускать ежедневно через pg_cron под service_role. ADR-030.';
