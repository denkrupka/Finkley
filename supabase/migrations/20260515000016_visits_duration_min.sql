-- visits.duration_min — длительность визита в минутах. Раньше выводилась
-- из service.default_duration_min при рендере календаря, что давало
-- неконсистентный UX: юзер задаёт end_time в форме (10:00 → 11:00),
-- но карточка визита всё равно растягивалась по дефолту услуги. Если
-- у услуги duration_min мал/null — карточка сжималась до 1 мин и текст
-- обрезался (баг image #85).
--
-- Новая семантика:
--   - duration_min хранится прямо на visit (если null — fallback на услугу
--     как раньше, для обратной совместимости со старыми записями);
--   - QuickEntryModal на submit пишет computed (end_time − start_time);
--   - VisitsCalendarView читает v.duration_min при рендере карточки.

alter table public.visits add column if not exists duration_min integer;
comment on column public.visits.duration_min is
  'Длительность визита в минутах. Если null — используется service.default_duration_min или 60 как дефолт';

-- Бэкфилл существующих visits: проставляем duration_min из услуги.
-- Это даёт стабильный рендер для исторических записей и снимает
-- разнотык «карточка зависит от того, не менялась ли услуга с тех пор».
update public.visits v
set duration_min = s.default_duration_min
from public.services s
where v.service_id = s.id
  and v.duration_min is null
  and s.default_duration_min is not null;
