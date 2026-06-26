-- =============================================================================
-- 20260626000002_setup_progress_v2.sql
-- =============================================================================
-- T2 (v2) — расширение gamified «Настройки Finkley».
--
-- Онбординг сокращён до короткого потока, поэтому чек-лист «Настройка Finkley»
-- доводит юзера до полного заполнения салона. Эта миграция РАСШИРЯЕТ RPC
-- public.setup_progress, добавляя новые boolean-поля трекинга для каждой
-- задачи чек-листа (доходы/расходы/банк/финансы/маркетинг/мессенджеры/
-- интеграции/склад/мониторинг конкурентов/AI).
--
-- ВАЖНО (обратная совместимость и reward-логика):
--   * Return type функции МЕНЯЕТСЯ → требуется DROP + CREATE (нельзя CREATE
--     OR REPLACE при изменении OUT-колонок). СУЩЕСТВУЮЩИЕ поля сохранены 1:1:
--     salon_created / has_visit / has_expense / booksy_connected /
--     bank_connected / dashboard_opened / created_at / reward_granted_at.
--   * Награда «+14 дней» по-прежнему гейтит ТОЛЬКО core-набор (визит + расход
--     + dashboard + опционально booksy/банк). Edge function claim-setup-reward
--     не трогаем — серверный hard-гейт остаётся «>=1 визит И >=1 расход».
--     Новые поля — для трекинга/полноты чек-листа, НЕ для награды.
--   * security invoker (default) сохраняется → RLS на всех читаемых таблицах
--     применяется, юзер видит только свой салон. Где у таблицы нет прямого
--     salon_id (bank_transactions, bank_tx_splits, ai_messages) — join вверх
--     до salon-scoped таблицы, RLS которой и режет доступ.
--
-- Источники детекции (все из РЕАЛЬНЫХ таблиц, НЕ из кликов клиента):
--   has_first_client_closed — visits.status='paid' (закрыт/рассчитан клиент)
--   has_expense_calculated  — payouts.status='paid' (рассчитан период зарплат)
--   has_scheduled_payment   — scheduled_payments (платёж запланирован)
--   bank_synced             — bank_connections.last_synced_at is not null
--   has_bank_tx_linked      — bank_transactions.expense_id OR bank_tx_splits
--                             kind='expense' (банк-транзакция слинкована с расходом)
--   has_finance_report      — TODO: нет таблицы трекинга генерации отчётов
--                             (P&L/ДДС). Заглушка false до появления трекинга.
--   has_competitor          — competitors (мониторинг конкурента добавлен)
--   has_social_page         — salons.instagram_url|facebook_url
--   has_google_profile      — salons.google_place_id
--   has_inventory_item      — inventory_items (первый товар на складе)
--   has_marketing_broadcast — TODO: нет таблицы отправленных рассылок (есть
--                             только salons.broadcast_prefs). Заглушка false.
--   has_messenger_message   — messenger_messages (канал + >=1 сообщение)
--   ai_assistant_seen       — ai_conversations (знакомство с AI-ассистентом)
--   booking_connected       — salon_integrations booking-провайдер connected
--   any_integration         — любая salon_integrations connected
-- =============================================================================

-- Return type меняется → пересоздаём функцию целиком.
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
  -- ── новые (v2 трекинг полноты) ──
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
    -- Расходы: рассчитан период зарплат (закрытый payout).
    exists (
      select 1 from public.payouts p
       where p.salon_id = p_salon_id and p.status = 'paid'
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
    -- Финансы: сгенерирован отчёт (P&L/ДДС). TODO: нет таблицы трекинга
    -- генерации/экспорта финотчётов → заглушка false до появления трекинга.
    false as has_finance_report,
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
    -- Маркетинг: первая рассылка отправлена. TODO: нет таблицы отправленных
    -- рассылок (только salons.broadcast_prefs) → заглушка false.
    false as has_marketing_broadcast,
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
  'Серверный прогресс «Настройки Finkley» (v2). security invoker → RLS '
  'каждой читаемой таблицы режет доступ к чужим салонам. Core-поля '
  '(has_visit/has_expense/...) гейтят награду «+14 дней»; v2-поля '
  '(has_competitor/has_inventory_item/...) — для полноты чек-листа. '
  'has_finance_report и has_marketing_broadcast — заглушки false (нет '
  'таблицы трекинга генерации отчётов / отправленных рассылок).';
