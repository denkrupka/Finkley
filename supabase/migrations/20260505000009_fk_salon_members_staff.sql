-- =============================================================================
-- 20260505000009_fk_salon_members_staff.sql
-- =============================================================================
-- Добавляет FK salon_members.staff_id → staff.id.
--
-- Миграция 000002 создаёт salon_members до того, как 000003 создаёт staff,
-- поэтому FK не мог быть объявлен сразу. Согласно docs/03_DATA_MODEL.md
-- его нужно добавить отдельным ALTER после создания staff.
-- =============================================================================

alter table public.salon_members
  add constraint fk_salon_members_staff
  foreign key (staff_id) references public.staff(id) on delete set null;
