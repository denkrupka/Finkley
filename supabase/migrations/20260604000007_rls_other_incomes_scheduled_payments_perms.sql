-- =============================================================================
-- RLS политики на other_incomes и scheduled_payments через has_perm.
-- Продолжение миграции 20260604000006 (expenses), та же логика.
--
-- Visits не трогаем — там уже role-based политики (20260508000006) с
-- более сложной логикой видимости (мастер видит свои визиты по staff_id).
-- has_perm можно подключить позже отдельной миграцией если потребуется.
--
-- Категории permissions:
--   - other_incomes:      income.other
--   - scheduled_payments: expenses.pending
-- =============================================================================

-- other_incomes
drop policy if exists "members access other_incomes" on public.other_incomes;

create policy "other_incomes_select_perm" on public.other_incomes
  for select using (
    public.has_perm(salon_id, 'income', 'other', 'view')
  );

create policy "other_incomes_insert_perm" on public.other_incomes
  for insert with check (
    public.has_perm(salon_id, 'income', 'other', 'edit')
  );

create policy "other_incomes_update_perm" on public.other_incomes
  for update using (
    public.has_perm(salon_id, 'income', 'other', 'edit')
  ) with check (
    public.has_perm(salon_id, 'income', 'other', 'edit')
  );

create policy "other_incomes_delete_perm" on public.other_incomes
  for delete using (
    public.has_perm(salon_id, 'income', 'other', 'edit')
  );

-- scheduled_payments
drop policy if exists "members access scheduled_payments" on public.scheduled_payments;

create policy "scheduled_payments_select_perm" on public.scheduled_payments
  for select using (
    public.has_perm(salon_id, 'expenses', 'pending', 'view')
  );

create policy "scheduled_payments_insert_perm" on public.scheduled_payments
  for insert with check (
    public.has_perm(salon_id, 'expenses', 'pending', 'edit')
  );

create policy "scheduled_payments_update_perm" on public.scheduled_payments
  for update using (
    public.has_perm(salon_id, 'expenses', 'pending', 'edit')
  ) with check (
    public.has_perm(salon_id, 'expenses', 'pending', 'edit')
  );

create policy "scheduled_payments_delete_perm" on public.scheduled_payments
  for delete using (
    public.has_perm(salon_id, 'expenses', 'pending', 'edit')
  );

comment on policy "other_incomes_select_perm" on public.other_incomes is
  'T36 — SELECT через has_perm(income.other, view). Owner/admin всегда true.';
comment on policy "scheduled_payments_select_perm" on public.scheduled_payments is
  'T36 — SELECT через has_perm(expenses.pending, view). Owner/admin всегда true.';
