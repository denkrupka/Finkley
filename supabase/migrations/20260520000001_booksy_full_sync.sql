-- =============================================================================
-- 20260520000001_booksy_full_sync.sql
-- =============================================================================
-- ADR-017: Booksy full sync — scope, ownership, tiered intervals
--
-- Добавляет:
--   * clients.discount_percent (0..100) — персональная скидка клиента,
--     auto-apply в форме визита (юзер может снять)
--   * clients/staff/services/salons.*external_snapshot — jsonb snapshot
--     последнего Booksy-значения для anti-overwrite (см. ADR-017 §4)
--   * staff.email/invite_sent_at/invite_token — invite flow мастеров
--   * salons.working_hours (jsonb того же формата что staff.weekly_schedule)
--   * salon_integrations.config (jsonb {booksy_owns_payment_status,
--     booksy_can_delete_visits}) + last_clients_sync_at + last_catalog_sync_at
-- =============================================================================

-- ─── clients: discount_percent + external_snapshot ───────────────────────
alter table public.clients
  add column if not exists discount_percent numeric(5,2)
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  add column if not exists external_snapshot jsonb;

comment on column public.clients.discount_percent is
  'Персональная скидка клиента (0..100%). Auto-apply в форме визита; юзер может снять.';
comment on column public.clients.external_snapshot is
  'Snapshot последнего значения полей из внешней системы (Booksy). Для anti-overwrite — см. ADR-017 §4.';

-- ─── staff: email + invite + external_snapshot ───────────────────────────
alter table public.staff
  add column if not exists email text,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists invite_token uuid,
  add column if not exists external_snapshot jsonb;

create unique index if not exists ux_staff_invite_token
  on public.staff(invite_token)
  where invite_token is not null;

comment on column public.staff.email is
  'Email мастера (для отправки invite в портал). Sync из Booksy /me/resources/{id}.staff_email.';
comment on column public.staff.invite_sent_at is
  'Когда отправлено приглашение в портал. NULL = не приглашён.';
comment on column public.staff.invite_token is
  'Одноразовый токен для onboarding-deeplink мастера. NULL после использования.';

-- ─── services: external_snapshot ─────────────────────────────────────────
alter table public.services
  add column if not exists external_snapshot jsonb;

comment on column public.services.external_snapshot is
  'Snapshot последнего значения name/price/duration из Booksy. Для anti-overwrite.';

-- ─── visits: external_reservation_id ─────────────────────────────────────
-- Для auto-резервации в Booksy при создании визита в Finkley:
-- сохраняем id созданной резервации, чтобы при удалении/изменении
-- визита в портале — корректно удалить/обновить блок в Booksy.
alter table public.visits
  add column if not exists external_reservation_id text;

comment on column public.visits.external_reservation_id is
  'ID резервации в Booksy для visits созданных в Finkley (auto-block слота в календаре Booksy).';

-- ─── salons: working_hours + snapshot ────────────────────────────────────
-- Формат: {"mon": {"start": "HH:MM", "end": "HH:MM", "off": false}, ...}
-- Тот же что у staff.weekly_schedule — UI/расчёты переиспользуем.
alter table public.salons
  add column if not exists working_hours jsonb not null default jsonb_build_object(
    'mon', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'tue', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'wed', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'thu', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'fri', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'sat', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', true),
    'sun', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', true)
  ),
  add column if not exists working_hours_external_snapshot jsonb;

comment on column public.salons.working_hours is
  'Рабочие часы салона по дням недели (jsonb). Sync из Booksy /shifts/opening_hours.';
comment on column public.salons.working_hours_external_snapshot is
  'Raw snapshot Booksy opening_hours (включая множественные интервалы), для anti-overwrite.';

-- ─── salon_integrations: config + tiered timestamps ──────────────────────
alter table public.salon_integrations
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists last_clients_sync_at timestamptz,
  add column if not exists last_catalog_sync_at timestamptz;

comment on column public.salon_integrations.config is
  'Per-provider настройки. Для booksy: {booksy_owns_payment_status: bool, booksy_can_delete_visits: bool} — см. ADR-017 §5.';
comment on column public.salon_integrations.last_clients_sync_at is
  'Последний sync клиентов (tier 20 мин для Booksy).';
comment on column public.salon_integrations.last_catalog_sync_at is
  'Последний sync каталога — services/staff/salon hours (tier 60 мин для Booksy).';

-- Расширяем public view: UI должен видеть config + tier timestamps
drop view if exists public.salon_integrations_public;
create or replace view public.salon_integrations_public as
  select id, salon_id, provider, status, last_sync_at, last_sync_stats,
         last_error, connected_at, updated_at, sync_interval_minutes,
         config, last_clients_sync_at, last_catalog_sync_at
    from public.salon_integrations;

grant select on public.salon_integrations_public to authenticated;
