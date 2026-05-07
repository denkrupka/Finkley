-- Группировка визитов в UI: для multi-service записей Booksy (один
-- appointment = несколько услуг) создаём N visits per subbooking, чтобы
-- KPI по мастерам/услугам считались точно. Но в списке визитов
-- показываем их как одну раскрывающуюся строку через общий group_key.
--
-- group_key text формата 'booksy:appt:{uid}' (или null для одиночных).
-- В будущем — другие источники: 'fresha:appt:N', 'manual:abc' если юзер
-- руками объединит несколько визитов в один.

alter table public.visits
  add column if not exists group_key text;

create index if not exists idx_visits_group_key
  on public.visits(salon_id, group_key)
  where group_key is not null and deleted_at is null;
