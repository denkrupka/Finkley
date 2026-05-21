-- =============================================================================
-- 20260521000019_salons_geo_fields.sql
-- =============================================================================
-- Геополя салона для:
--   1. Автоподбора конкурентов через Google Places Nearby Search
--   2. Отображения «своего салона» рядом с конкурентами (rating с Google)
--   3. Будущей карты салонов в админке
-- =============================================================================

alter table public.salons
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists lat numeric(9, 6),
  add column if not exists lng numeric(9, 6),
  add column if not exists google_place_id text,
  add column if not exists booksy_url text;

comment on column public.salons.lat is 'Latitude для Google Places Nearby Search.';
comment on column public.salons.lng is 'Longitude для Google Places Nearby Search.';
comment on column public.salons.google_place_id is
  'Google Place ID — стабильный идентификатор для Places API (reviews/details).';
comment on column public.salons.booksy_url is
  'Публичная страница салона на Booksy (для скрейпинга своих цен и сравнения).';
