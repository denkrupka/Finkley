-- Добавляем external_id/external_source клиентам, чтобы импорт из Booksy
-- (и других интеграций) был идемпотентным — повторный sync не плодит дубли.
--
-- Источники: 'booksy', 'fresha', etc. external_id — id из платформы.

alter table public.clients
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists ux_clients_external
  on public.clients(salon_id, external_source, external_id)
  where external_id is not null;
