-- =============================================================================
-- 20260520000003_staff_avatar.sql
-- =============================================================================
-- Аватарки мастеров (фото из Booksy /me/resources/{id}.photo_url).
-- Храним только URL — Booksy CDN отдаёт публично, нет смысла прокачивать
-- через наш Storage. Тип text, nullable. Anti-overwrite через
-- external_snapshot.avatar_url (см. ADR-017 §4).
-- =============================================================================

alter table public.staff
  add column if not exists avatar_url text;

comment on column public.staff.avatar_url is
  'Публичный URL аватара мастера. Синкается из Booksy /me/resources/{id}.photo_url.';
