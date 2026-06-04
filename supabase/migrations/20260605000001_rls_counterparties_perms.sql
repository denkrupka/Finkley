-- =============================================================================
-- RLS политики на counterparties через has_perm.
-- counterparties — справочник контрагентов используется в:
--  - expenses (vendor)
--  - other_incomes (плательщик)
-- Для view: достаточно view на expenses ИЛИ income.other.
-- Для edit: edit на expenses ИЛИ income.other.
--
-- Старые "cp_select" и "cp_modify" политики DROP'аются.
-- =============================================================================

drop policy if exists "cp_select" on public.counterparties;
drop policy if exists "cp_modify" on public.counterparties;

create policy "counterparties_select_perm" on public.counterparties
  for select using (
    public.has_perm(salon_id, 'expenses', null, 'view')
    or public.has_perm(salon_id, 'income', 'other', 'view')
  );

create policy "counterparties_insert_perm" on public.counterparties
  for insert with check (
    public.has_perm(salon_id, 'expenses', null, 'edit')
    or public.has_perm(salon_id, 'income', 'other', 'edit')
  );

create policy "counterparties_update_perm" on public.counterparties
  for update using (
    public.has_perm(salon_id, 'expenses', null, 'edit')
    or public.has_perm(salon_id, 'income', 'other', 'edit')
  ) with check (
    public.has_perm(salon_id, 'expenses', null, 'edit')
    or public.has_perm(salon_id, 'income', 'other', 'edit')
  );

create policy "counterparties_delete_perm" on public.counterparties
  for delete using (
    public.has_perm(salon_id, 'expenses', null, 'edit')
    or public.has_perm(salon_id, 'income', 'other', 'edit')
  );

comment on policy "counterparties_select_perm" on public.counterparties is
  'T36 — SELECT через has_perm(expenses.view ИЛИ income.other.view). Owner/admin всегда true.';
