-- =============================================================================
-- RLS политики на expenses с проверкой permissions через has_perm.
-- Owner-feedback 04.06: master через дев-консоль мог SELECT/INSERT/UPDATE/
-- DELETE расходы напрямую — client-side guards не давали гарантии.
--
-- Старая политика "members access expenses" разрешала всё членам салона.
-- Новые 4 политики: SELECT требует has_perm(expenses, view),
-- INSERT/UPDATE/DELETE — has_perm(expenses, edit).
--
-- has_perm (миграция 20260604000005) для owner/admin всегда true — они
-- работают как раньше. Master без явных permissions получит RLS deny.
--
-- ВАЖНО: legacy политика DROP'ается. Если что-то упадёт, миграция откатывается
-- транзакционно (migration runs in one tx через supabase migrate).
-- =============================================================================

drop policy if exists "members access expenses" on public.expenses;

create policy "expenses_select_perm" on public.expenses
  for select using (
    public.has_perm(salon_id, 'expenses', null, 'view')
  );

create policy "expenses_insert_perm" on public.expenses
  for insert with check (
    public.has_perm(salon_id, 'expenses', null, 'edit')
  );

create policy "expenses_update_perm" on public.expenses
  for update using (
    public.has_perm(salon_id, 'expenses', null, 'edit')
  ) with check (
    public.has_perm(salon_id, 'expenses', null, 'edit')
  );

create policy "expenses_delete_perm" on public.expenses
  for delete using (
    public.has_perm(salon_id, 'expenses', null, 'edit')
  );

comment on policy "expenses_select_perm" on public.expenses is
  'T36 — SELECT разрешён если has_perm(salon, expenses, view). Owner/admin всегда true.';
comment on policy "expenses_insert_perm" on public.expenses is
  'T36 — INSERT разрешён если has_perm(salon, expenses, edit). Owner/admin всегда true.';
comment on policy "expenses_update_perm" on public.expenses is
  'T36 — UPDATE разрешён если has_perm(salon, expenses, edit). Owner/admin всегда true.';
comment on policy "expenses_delete_perm" on public.expenses is
  'T36 — DELETE разрешён если has_perm(salon, expenses, edit). Owner/admin всегда true.';
