-- staff_services — какие услуги ВЫПОЛНЯЕТ мастер (M:N staff ↔ services).
--
-- Отдельно от staff_service_overrides (там — переопределение % выплат по услуге).
-- Здесь хранится факт «мастер делает эту услугу» — для настроек мастера и для
-- публичного API (GET /v1/staff-services?staff_id=...).

create table if not exists public.staff_services (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (staff_id, service_id)
);

create index if not exists idx_staff_services_salon_staff
  on public.staff_services(salon_id, staff_id);
create index if not exists idx_staff_services_service
  on public.staff_services(service_id);

alter table public.staff_services enable row level security;

-- Доступ — членам салона (как у visit_templates и др. salon-scoped таблиц).
create policy "members access staff_services" on public.staff_services
  for all using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  )
  with check (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );

grant select, insert, update, delete on public.staff_services to authenticated;
grant all on public.staff_services to service_role;
