-- =============================================================================
-- 20260514170000_blocked_salons_visibility.sql
-- =============================================================================
-- PR4: пользователи должны видеть свой заблокированный салон, чтобы фронт
-- мог нарисовать страницу «Ваш салон заблокирован». Раньше (PR2) RLS прятала
-- блокированные салоны полностью — это вызывало «404 redirect to /»,
-- неинформативно для пользователя.
--
-- Меняем: SELECT-политика снова показывает блокированные салоны; UPDATE и
-- INSERT в дочерние сущности будут отрезаны через app-level проверки
-- (`SalonLayout` редиректит на /blocked/salon/:id; admin даёт доступ через
-- service-role).
-- =============================================================================

drop policy if exists "members can read their salons" on public.salons;
create policy "members can read their salons" on public.salons
  for select using (
    id in (select salon_id from public.salon_members where user_id = auth.uid())
    and deleted_at is null
  );
