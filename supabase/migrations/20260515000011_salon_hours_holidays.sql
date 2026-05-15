-- =============================================================================
-- salons.opening_hours + salon_holidays — график работы салона + выходные.
-- =============================================================================
-- Используется:
--   - В календаре резерваций для штриховки нерабочего времени и выходных дней
--   - В будущем — для блокировки создания визитов в выходные / нерабочее время
--   - Для дайджестов / отчётов — учитывать только рабочие дни
-- =============================================================================

-- ─── 1. opening_hours JSONB на salons ─────────────────────────────────────
-- Структура (по умолчанию для новых салонов — 7 дней, 09:00–20:00):
--   {
--     "mon": { "open": "09:00", "close": "20:00", "closed": false },
--     "tue": { ... }, ...
--     "sun": { "open": "10:00", "close": "18:00", "closed": false }
--   }
-- Закрытый день: { "closed": true }
-- =============================================================================

alter table public.salons
  add column if not exists opening_hours jsonb not null default jsonb_build_object(
    'mon', jsonb_build_object('open', '09:00', 'close', '20:00', 'closed', false),
    'tue', jsonb_build_object('open', '09:00', 'close', '20:00', 'closed', false),
    'wed', jsonb_build_object('open', '09:00', 'close', '20:00', 'closed', false),
    'thu', jsonb_build_object('open', '09:00', 'close', '20:00', 'closed', false),
    'fri', jsonb_build_object('open', '09:00', 'close', '20:00', 'closed', false),
    'sat', jsonb_build_object('open', '10:00', 'close', '18:00', 'closed', false),
    'sun', jsonb_build_object('closed', true)
  );

comment on column public.salons.opening_hours is
  'Расписание салона по дням недели. JSONB ключи mon|tue|wed|thu|fri|sat|sun, значение {open, close, closed}. Используется в календаре резерваций для штриховки.';

-- ─── 2. salon_holidays — выходные дни (праздники + индивидуальные) ────────

create table if not exists public.salon_holidays (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references public.salons(id) on delete cascade,
  date         date not null,
  label        text not null,
  is_recurring boolean not null default false,
  -- Если запись пришла из template — фиксируем страну, чтобы можно было
  -- одной кнопкой удалить все праздники этой страны.
  country_code text,
  created_at   timestamptz not null default now(),
  unique (salon_id, date)
);

create index if not exists idx_salon_holidays_salon_date
  on public.salon_holidays(salon_id, date);

alter table public.salon_holidays enable row level security;

create policy "salon_holidays_select" on public.salon_holidays
  for select using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = salon_holidays.salon_id
         and sm.user_id = auth.uid()
    )
  );

create policy "salon_holidays_insert" on public.salon_holidays
  for insert with check (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = salon_holidays.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin')
    )
  );

create policy "salon_holidays_update" on public.salon_holidays
  for update using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = salon_holidays.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin')
    )
  );

create policy "salon_holidays_delete" on public.salon_holidays
  for delete using (
    exists (
      select 1 from public.salon_members sm
       where sm.salon_id = salon_holidays.salon_id
         and sm.user_id = auth.uid()
         and sm.role in ('owner', 'admin')
    )
  );

comment on table public.salon_holidays is
  'Выходные дни салона (государственные праздники, локальные закрытия и т.п.). Штрихуют день в календаре резерваций.';
