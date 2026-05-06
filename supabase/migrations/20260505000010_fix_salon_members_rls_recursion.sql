-- =============================================================================
-- 20260505000010_fix_salon_members_rls_recursion.sql
-- =============================================================================
-- Фикс: original "members can see own membership rows" policy на salon_members
-- (создана в миграции 000002) внутри своего USING-выражения делает SELECT
-- на ту же таблицу salon_members. Postgres ловит это как
-- "infinite recursion detected in policy for relation salon_members".
--
-- Решение: SECURITY DEFINER функция user_admin_salon_ids(), которая
-- возвращает salon_id'ы, где текущий юзер owner/admin. Внутренний select
-- к salon_members выполняется с правами owner функции и не подпадает под RLS,
-- что разрывает цикл.
--
-- Поведение сохраняется ровно как задумано в docs/03_DATA_MODEL.md:
-- юзер видит свою membership-строку, плюс owner/admin видит всех членов
-- своих салонов.
-- =============================================================================

create or replace function public.user_admin_salon_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select salon_id
  from public.salon_members
  where user_id = auth.uid()
    and role in ('owner', 'admin');
$$;

revoke all on function public.user_admin_salon_ids() from public;
grant execute on function public.user_admin_salon_ids() to authenticated;

drop policy if exists "members can see own membership rows" on public.salon_members;

create policy "members can see own membership rows" on public.salon_members
  for select using (
    user_id = auth.uid()
    or salon_id in (select public.user_admin_salon_ids())
  );
