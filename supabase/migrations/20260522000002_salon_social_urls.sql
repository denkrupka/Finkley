-- =============================================================================
-- 20260522000002_salon_social_urls.sql
-- =============================================================================
-- IG/FB URLs для своего салона (раньше были только у competitors).
-- Используется в:
--   - Settings → Профиль → блок «Адрес и публичные ссылки» (новые поля)
--   - competitor-sync — теперь снимает метрики и для своего салона
--     (показывает в Reports → Конкуренты первой строкой)
-- =============================================================================

alter table public.salons
  add column if not exists instagram_url text,
  add column if not exists facebook_url text;

comment on column public.salons.instagram_url is
  'URL Instagram-страницы салона. Используется в competitor-sync для метрик контента (followers, posts) — сравнение со своими цифрами.';
comment on column public.salons.facebook_url is
  'URL Facebook-страницы салона. Используется в competitor-sync для метрик likes/followers — сравнение со своими цифрами.';
