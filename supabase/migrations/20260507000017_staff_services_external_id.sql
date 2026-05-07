-- Аналогично clients — добавляем external_id/source для staff и services,
-- чтобы при синке Booksy визитов можно было резолвить staff_id и service_id
-- по external_id из Booksy (resource_id для staff, service.id для services),
-- а не by-name (которое неустойчиво к переименованиям и дубликатам).

alter table public.staff
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists ux_staff_external
  on public.staff(salon_id, external_source, external_id)
  where external_id is not null;

alter table public.services
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists ux_services_external
  on public.services(salon_id, external_source, external_id)
  where external_id is not null;
