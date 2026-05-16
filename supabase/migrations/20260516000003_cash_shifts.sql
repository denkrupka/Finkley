-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000003_cash_shifts.sql
--
-- Кассовая дисциплина — модуль «Касса» в Финансах. Каждая смена фиксирует:
--   1. opening_amount_cents + opened_by_user_id + opened_at  — кто, когда,
--      с какой суммой принял ответственность за кассу.
--   2. actual_cash/card_cents + expected_*  — слепой ввод фактического
--      пересчёта и расчётные ожидания на момент закрытия (snapshot,
--      чтобы исторические отчёты не плыли при изменении визитов задним
--      числом).
--   3. closed_by_user_id + closed_at + status='closed'  — кто, когда сдал.
--
-- Зачем храним expected_* как snapshot, а не пересчитываем при чтении:
-- если кто-то задним числом меняет визиты/расходы в закрытой смене, отчёт
-- по сверке должен остаться неизменным (это юридически значимое событие).
--
-- В каждом салоне может быть только одна `open` смена за раз — индекс
-- `cash_shifts_one_open_per_salon` это гарантирует.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists cash_shifts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,

  -- Открытие смены
  opened_at timestamptz not null default now(),
  opened_by_user_id uuid references auth.users(id) on delete set null,
  opening_amount_cents bigint not null default 0,
  opening_comment text,

  -- Закрытие смены (NULL пока open)
  closed_at timestamptz,
  closed_by_user_id uuid references auth.users(id) on delete set null,

  -- Слепой ввод факта при закрытии
  actual_cash_cents bigint,
  actual_card_cents bigint,

  -- Snapshot ожидаемых сумм на момент закрытия (для устойчивости отчётов)
  expected_cash_cents bigint,
  expected_card_cents bigint,

  -- Diff = factually - expected. Заполняется приложением при закрытии.
  -- Отдельная колонка (а не computed) — у нас она nullable пока open.
  diff_cash_cents bigint,
  diff_card_cents bigint,

  close_comment text,
  discrepancy_reason text,

  status text not null default 'open' check (status in ('open', 'closed')),

  created_at timestamptz not null default now()
);

comment on table cash_shifts is
  'Кассовые смены: opening_amount + slepое сверка при закрытии. Для разбирательств по недостачам.';

-- Один салон = одна открытая смена за раз.
create unique index if not exists cash_shifts_one_open_per_salon
  on cash_shifts(salon_id)
  where status = 'open';

-- История по дате открытия (desc).
create index if not exists cash_shifts_salon_opened_at
  on cash_shifts(salon_id, opened_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table cash_shifts enable row level security;

-- Все члены салона видят все смены.
create policy "cash_shifts_select" on cash_shifts
  for select to authenticated
  using (
    exists (
      select 1 from salon_members sm
      where sm.salon_id = cash_shifts.salon_id
        and sm.user_id = auth.uid()
    )
  );

-- Любой член салона может открыть смену.
create policy "cash_shifts_insert" on cash_shifts
  for insert to authenticated
  with check (
    exists (
      select 1 from salon_members sm
      where sm.salon_id = cash_shifts.salon_id
        and sm.user_id = auth.uid()
    )
  );

-- Любой член салона может обновить смену (закрыть, поменять комментарий).
-- Бизнес-логика «кто открыл — тот и закрывает» делается на клиенте, в
-- БД мы это не enforce'им (кассир может сменить пользователя в течение
-- дня — нужна гибкость).
create policy "cash_shifts_update" on cash_shifts
  for update to authenticated
  using (
    exists (
      select 1 from salon_members sm
      where sm.salon_id = cash_shifts.salon_id
        and sm.user_id = auth.uid()
    )
  );
