-- =============================================================================
-- 20260616000001_staff_job_role.sql
-- =============================================================================
-- staff.job_role — кто этот сотрудник по роли в работе салона:
--   'master'    — принимает клиентов (мастер). ДЕФОЛТ.
--   'admin'     — администратор
--   'manager'   — управляющий
--   'reception' — ресепшен
--   'other'     — прочее
--
-- Отличается от salon_members.role (это про доступ к приложению). job_role —
-- про «кого считать мастером»: в AI-анализах онбординга и в аналитике мы
-- используем ТОЛЬКО мастеров, чтобы не писать советы про админов/ресепшен
-- без визитов (запрос владельца). Все существующие и импортированные из Booksy
-- сотрудники по умолчанию мастера — поведение не меняется, пока владелец сам
-- не переключит роль в онбординге/справочнике мастеров.
-- =============================================================================

alter table public.staff
  add column if not exists job_role text not null default 'master';

alter table public.staff
  drop constraint if exists staff_job_role_check;

alter table public.staff
  add constraint staff_job_role_check
  check (job_role in ('master', 'admin', 'manager', 'reception', 'other'));

comment on column public.staff.job_role is
  'Роль сотрудника в работе салона: master (принимает клиентов, дефолт) | admin | manager | reception | other. Для AI-анализов и аналитики используем только master.';
