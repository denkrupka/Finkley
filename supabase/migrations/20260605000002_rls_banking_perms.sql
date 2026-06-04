-- =============================================================================
-- RLS на bank_connections / bank_accounts / bank_transactions через has_perm.
--
-- Banking data используется и для income (credit transactions) и для expenses
-- (debit transactions). Logica:
--   • view: income.banking.view ИЛИ expenses.banking.view
--   • edit: income.banking.edit ИЛИ expenses.banking.edit
--
-- bank_accounts и bank_transactions не имеют прямого salon_id — связь
-- через bank_connections. Делаем через подзапрос.
--
-- Существующие политики (members access, owner/admin modify, _update) DROP'аются.
-- =============================================================================

-- ─── bank_connections ─────────────────────────────────────────────────────────
drop policy if exists "bank_connections_select" on public.bank_connections;
drop policy if exists "bank_connections_modify_owner" on public.bank_connections;

create policy "bank_connections_select_perm" on public.bank_connections
  for select using (
    public.has_perm(salon_id, 'income', 'banking', 'view')
    or public.has_perm(salon_id, 'expenses', 'banking', 'view')
  );

create policy "bank_connections_insert_perm" on public.bank_connections
  for insert with check (
    public.has_perm(salon_id, 'income', 'banking', 'edit')
    or public.has_perm(salon_id, 'expenses', 'banking', 'edit')
  );

create policy "bank_connections_update_perm" on public.bank_connections
  for update using (
    public.has_perm(salon_id, 'income', 'banking', 'edit')
    or public.has_perm(salon_id, 'expenses', 'banking', 'edit')
  ) with check (
    public.has_perm(salon_id, 'income', 'banking', 'edit')
    or public.has_perm(salon_id, 'expenses', 'banking', 'edit')
  );

create policy "bank_connections_delete_perm" on public.bank_connections
  for delete using (
    public.has_perm(salon_id, 'income', 'banking', 'edit')
    or public.has_perm(salon_id, 'expenses', 'banking', 'edit')
  );

-- ─── bank_accounts ───────────────────────────────────────────────────────────
drop policy if exists "bank_accounts_select" on public.bank_accounts;
drop policy if exists "bank_accounts_update" on public.bank_accounts;

create policy "bank_accounts_select_perm" on public.bank_accounts
  for select using (
    connection_id in (
      select bc.id from public.bank_connections bc
       where public.has_perm(bc.salon_id, 'income', 'banking', 'view')
          or public.has_perm(bc.salon_id, 'expenses', 'banking', 'view')
    )
  );

create policy "bank_accounts_update_perm" on public.bank_accounts
  for update using (
    connection_id in (
      select bc.id from public.bank_connections bc
       where public.has_perm(bc.salon_id, 'income', 'banking', 'edit')
          or public.has_perm(bc.salon_id, 'expenses', 'banking', 'edit')
    )
  ) with check (
    connection_id in (
      select bc.id from public.bank_connections bc
       where public.has_perm(bc.salon_id, 'income', 'banking', 'edit')
          or public.has_perm(bc.salon_id, 'expenses', 'banking', 'edit')
    )
  );

-- ─── bank_transactions ───────────────────────────────────────────────────────
drop policy if exists "bank_transactions_select" on public.bank_transactions;
drop policy if exists "bank_transactions_update" on public.bank_transactions;

create policy "bank_transactions_select_perm" on public.bank_transactions
  for select using (
    account_id in (
      select ba.id from public.bank_accounts ba
       join public.bank_connections bc on bc.id = ba.connection_id
       where public.has_perm(bc.salon_id, 'income', 'banking', 'view')
          or public.has_perm(bc.salon_id, 'expenses', 'banking', 'view')
    )
  );

create policy "bank_transactions_update_perm" on public.bank_transactions
  for update using (
    account_id in (
      select ba.id from public.bank_accounts ba
       join public.bank_connections bc on bc.id = ba.connection_id
       where public.has_perm(bc.salon_id, 'income', 'banking', 'edit')
          or public.has_perm(bc.salon_id, 'expenses', 'banking', 'edit')
    )
  ) with check (
    account_id in (
      select ba.id from public.bank_accounts ba
       join public.bank_connections bc on bc.id = ba.connection_id
       where public.has_perm(bc.salon_id, 'income', 'banking', 'edit')
          or public.has_perm(bc.salon_id, 'expenses', 'banking', 'edit')
    )
  );

comment on policy "bank_connections_select_perm" on public.bank_connections is
  'T36/FF — SELECT через has_perm(income.banking.view ИЛИ expenses.banking.view).';
