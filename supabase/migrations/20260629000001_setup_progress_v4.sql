-- =============================================================================
-- 20260629000001_setup_progress_v4.sql
-- =============================================================================
-- T2 (v4) — задача чек-листа «Настройка Finkley» «Рассчитайте зарплату»
-- становится «Выдайте зарплату или аванс» (owner-feedback 2026-06-29).
--
-- Что меняется (ровно одно поле — has_expense_calculated):
--   ДО (v3): засчитывалось только когда реально ЗАКРЫТ зарплатный период
--            (exists payouts.status='paid'). Это необратимое действие
--            (создаётся расход «Зарплаты», пересчёт периода блокируется) —
--            слишком тяжёлый барьер для онбординга новичка.
--   ПОСЛЕ (v4): засчитывается при ЛЮБОЙ выплате ЗП — расход в зарплатной
--            категории (expense_categories.is_payroll=true) ИЛИ с
--            expenses.payroll_kind in ('advance','final'). Это покрывает:
--              * новую кнопку «Выдать ЗП» в таблице /payouts (создаёт payroll-
--                расход с предвыбором мастера/суммы);
--              * выданные авансы (payroll_kind='advance');
--              * авто-расход при закрытии периода (он тоже в категории
--                «Зарплаты», is_payroll=true).
--            Старое условие (закрытый payout) оставлено через OR для полной
--            обратной совместимости с салонами, которые уже закрывали периоды.
--
-- Return type функции НЕ меняется (те же OUT-колонки в том же порядке), но для
-- замены тела используем DROP + CREATE — та же практика, что в v2/v3. Маппинг
-- serverKey в apps/web/src/lib/setup-progress.ts НЕ меняется (поле то же —
-- has_expense_calculated). security invoker (default) сохраняется → RLS каждой
-- читаемой таблицы режет доступ к чужим салонам.
-- =============================================================================

drop function if exists public.setup_progress(uuid);

create function public.setup_progress(p_salon_id uuid)
returns table (
  -- ── существующие (back-compat) ──
  salon_created           boolean,
  has_visit               boolean,
  has_expense             boolean,
  booksy_connected        boolean,
  bank_connected          boolean,
  dashboard_opened        boolean,
  created_at              timestamptz,
  reward_granted_at       timestamptz,
  -- ── v2 трекинг полноты ──
  has_first_client_closed boolean,
  has_expense_calculated  boolean,
  has_scheduled_payment   boolean,
  bank_synced             boolean,
  has_bank_tx_linked      boolean,
  has_finance_report      boolean,
  has_competitor          boolean,
  has_social_page         boolean,
  has_google_profile      boolean,
  has_inventory_item      boolean,
  has_marketing_broadcast boolean,
  has_messenger_message   boolean,
  ai_assistant_seen       boolean,
  booking_connected       boolean,
  any_integration         boolean
)
language sql
stable
as $$
  select
    true as salon_created,
    exists (
      select 1 from public.visits v
       where v.salon_id = p_salon_id and v.deleted_at is null
    ) as has_visit,
    exists (
      select 1 from public.expenses e
       where e.salon_id = p_salon_id and e.deleted_at is null
    ) as has_expense,
    exists (
      select 1 from public.salon_integrations si
       where si.salon_id = p_salon_id
         and si.provider = 'booksy'
         and si.status = 'connected'
    ) as booksy_connected,
    exists (
      select 1 from public.bank_connections bc
       where bc.salon_id = p_salon_id and bc.status = 'connected'
    ) as bank_connected,
    (s.dashboard_opened_at is not null) as dashboard_opened,
    s.created_at,
    s.setup_reward_granted_at as reward_granted_at,

    -- ── v2 ──
    -- Доходы: первый клиент закрыт/рассчитан = визит со status='paid'.
    exists (
      select 1 from public.visits v
       where v.salon_id = p_salon_id and v.deleted_at is null
         and v.status = 'paid'
    ) as has_first_client_closed,
    -- Расходы: выдана зарплата или аванс (v4). Любой payroll-расход —
    -- категория is_payroll ИЛИ payroll_kind (advance/final) — ИЛИ (back-compat)
    -- закрытый зарплатный период.
    (
      exists (
        select 1
          from public.expenses e
          left join public.expense_categories ec on ec.id = e.category_id
         where e.salon_id = p_salon_id
           and e.deleted_at is null
           and (ec.is_payroll = true or e.payroll_kind in ('advance', 'final'))
      )
      or exists (
        select 1 from public.payouts p
         where p.salon_id = p_salon_id and p.status = 'paid'
      )
    ) as has_expense_calculated,
    -- Расходы: запланирован платёж (платёжный календарь).
    exists (
      select 1 from public.scheduled_payments sp
       where sp.salon_id = p_salon_id and sp.deleted_at is null
    ) as has_scheduled_payment,
    -- Банк синхронизирован (хотя бы раз дёрнут sync), не просто подключён.
    exists (
      select 1 from public.bank_connections bc
       where bc.salon_id = p_salon_id
         and bc.status = 'connected'
         and bc.last_synced_at is not null
    ) as bank_synced,
    -- Банк-транзакция слинкована с расходом: legacy FK expense_id ИЛИ split
    -- kind='expense'. Join вверх до salon через bank_accounts/bank_connections.
    exists (
      select 1
        from public.bank_transactions bt
        join public.bank_accounts ba on ba.id = bt.account_id
        join public.bank_connections bc on bc.id = ba.connection_id
       where bc.salon_id = p_salon_id
         and (
           bt.expense_id is not null
           or exists (
             select 1 from public.bank_tx_splits sp
              where sp.bank_transaction_id = bt.id and sp.kind = 'expense'
           )
         )
    ) as has_bank_tx_linked,
    -- Финансы: сгенерирован отчёт (P&L/ДДС). v3 — детект из tracking_events:
    -- SPA эмитит action 'finance_report_generated' при экспорте/печати отчёта.
    exists (
      select 1 from public.tracking_events te
       where te.salon_id = p_salon_id
         and te.event_type = 'action'
         and te.path = 'finance_report_generated'
    ) as has_finance_report,
    -- Мониторинг конкурента добавлен.
    exists (
      select 1 from public.competitors c
       where c.salon_id = p_salon_id and c.is_archived = false
    ) as has_competitor,
    -- Соц-страница салона (Instagram/Facebook) указана.
    (s.instagram_url is not null or s.facebook_url is not null) as has_social_page,
    -- Google business profile привязан.
    (s.google_place_id is not null) as has_google_profile,
    -- Склад: первый товар.
    exists (
      select 1 from public.inventory_items ii
       where ii.salon_id = p_salon_id and ii.is_archived = false
    ) as has_inventory_item,
    -- Маркетинг: первая рассылка отправлена. v3 — детект из tracking_events:
    -- edge function marketing-send-broadcast эмитит action
    -- 'marketing_broadcast_sent' при РЕАЛЬНОЙ успешной отправке (не dry_run).
    exists (
      select 1 from public.tracking_events te
       where te.salon_id = p_salon_id
         and te.event_type = 'action'
         and te.path = 'marketing_broadcast_sent'
    ) as has_marketing_broadcast,
    -- Мессенджеры: есть >=1 сообщение (любого направления).
    exists (
      select 1 from public.messenger_messages mm
       where mm.salon_id = p_salon_id
    ) as has_messenger_message,
    -- Знакомство с AI-ассистентом: есть хотя бы одна беседа.
    exists (
      select 1 from public.ai_conversations ac
       where ac.salon_id = p_salon_id
    ) as ai_assistant_seen,
    -- Интеграция бронирования (любой booking-провайдер) подключена.
    exists (
      select 1 from public.salon_integrations si
       where si.salon_id = p_salon_id
         and si.status = 'connected'
         and si.provider in ('booksy', 'fresha', 'treatwell', 'yclients', 'bookon')
    ) as booking_connected,
    -- Любая salon-интеграция подключена (booking ИЛИ accounting-портал).
    exists (
      select 1 from public.salon_integrations si
       where si.salon_id = p_salon_id and si.status = 'connected'
    ) as any_integration
  from public.salons s
  where s.id = p_salon_id;
$$;

revoke all on function public.setup_progress(uuid) from public;
grant execute on function public.setup_progress(uuid) to authenticated, service_role;

comment on function public.setup_progress(uuid) is
  'Серверный прогресс «Настройки Finkley» (v4). security invoker → RLS '
  'каждой читаемой таблицы режет доступ к чужим салонам. Core-поля '
  '(has_visit/has_expense/...) гейтят награду «+14 дней»; v2/v3-поля '
  '(has_competitor/has_inventory_item/...) — для полноты чек-листа. '
  'v4: has_expense_calculated («Выдайте зарплату или аванс») детектится по '
  'любому payroll-расходу (expense_categories.is_payroll OR '
  'expenses.payroll_kind in (advance,final)) ИЛИ по закрытому payout '
  '(back-compat). has_finance_report — из tracking_events action '
  '''finance_report_generated''; has_marketing_broadcast — из tracking_events '
  'action ''marketing_broadcast_sent''.';
