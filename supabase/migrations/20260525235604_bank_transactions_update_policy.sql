-- =============================================================================
-- 20260525235604_bank_transactions_update_policy.sql
-- =============================================================================
-- БАГ ПРОДА: bank_transactions имеет только SELECT policy (миграция
-- 20260509000002). UPDATE/INSERT/DELETE заблокированы RLS (default deny).
--
-- Симптом: юзер кликает «Связать» в /expenses → /banking → toast «Связано»
-- появляется (PostgREST возвращает success на UPDATE 0 affected rows),
-- но колонка «Связано с» остаётся «Не связано» — БД не меняется.
--
-- Симметрично сломаны:
--   • Обратная привязка из карточки расхода / визита / прочего дохода
--     (handleUnlinkBank в VisitDetailModal/OtherIncomeEditModal, link.mutate
--     в LinkExpense/Visit/OtherIncomeToBankDialog)
--   • Авто-link при импорте через banking-sync edge function проходит ОК
--     потому что edge function использует service-role-key который bypass'ит RLS.
--   • E2E-тесты не словили баг (тоже service-role в seed).
--
-- Фикс: добавить UPDATE policy для member'ов салона. INSERT/DELETE
-- оставляем заблокированными — транзакции импортируются только
-- banking-sync edge function (service-role bypass), юзер не должен иметь
-- права создавать/удалять.
--
-- Колонки которые юзер может менять: expense_id, linked_visit_id,
-- linked_other_income_id, needs_review. Это контролируется на
-- application-level (frontend хук useLinkBankTransaction передаёт только
-- эти patch-поля). На DB-level разрешаем UPDATE всей строки —
-- защита от смены account_id / external_id / amount будет через
-- column-level constraint в следующей итерации, если потребуется.
-- =============================================================================

drop policy if exists "bank_transactions_update" on public.bank_transactions;

create policy "bank_transactions_update" on public.bank_transactions
  for update using (
    account_id in (
      select id from public.bank_accounts
       where connection_id in (
         select id from public.bank_connections
          where salon_id in (
            select salon_id from public.salon_members where user_id = auth.uid()
          )
       )
    )
  )
  with check (
    account_id in (
      select id from public.bank_accounts
       where connection_id in (
         select id from public.bank_connections
          where salon_id in (
            select salon_id from public.salon_members where user_id = auth.uid()
          )
       )
    )
  );

comment on policy "bank_transactions_update" on public.bank_transactions is
  'Member салона может UPDATE bank_transactions (связь с expense/visit/other_income, needs_review). INSERT/DELETE — только service-role через banking-sync.';
