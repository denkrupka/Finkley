-- ============================================================================
-- bank_accounts: добавить UPDATE policy для членов салона.
--
-- Симптом: в Settings → Integrations → Banking при выборе кассы в дропдауне
-- «Связать с кассой» тост «Связь обновлена» появлялся, но значение
-- bank_accounts.cash_register_id оставалось NULL (после refetch — снова «—
-- Не связан»).
--
-- Причина: при создании таблицы в `20260509000002_bank_integration.sql`
-- была заведена только `bank_accounts_select` policy. UPDATE из SPA с
-- anon-ключом отфильтровывался RLS до 0 строк; PostgREST не считает это
-- ошибкой (возвращает 200 OK + 0 affected), поэтому хук
-- `useLinkBankAccountToRegister.mutate` не падал, и тост выводился как при
-- успешном сохранении.
--
-- Фикс: добавить UPDATE policy с тем же условием членства в салоне, что и
-- SELECT (доступ через bank_connections → salon_members).
-- ============================================================================

drop policy if exists "bank_accounts_update" on public.bank_accounts;
create policy "bank_accounts_update" on public.bank_accounts
  for update using (
    connection_id in (
      select id from public.bank_connections
       where salon_id in (
         select salon_id from public.salon_members where user_id = auth.uid()
       )
    )
  ) with check (
    connection_id in (
      select id from public.bank_connections
       where salon_id in (
         select salon_id from public.salon_members where user_id = auth.uid()
       )
    )
  );
