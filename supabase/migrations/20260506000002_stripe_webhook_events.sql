-- =============================================================================
-- 20260506000002_stripe_webhook_events.sql
-- =============================================================================
-- Идемпотентность Stripe webhook'а: сохраняем event.id каждого обработанного
-- события. При повторной доставке (Stripe ретраит при non-2xx) мы видим что
-- event уже обработан и просто отвечаем 200 без побочных эффектов.
--
-- Только service-role пишет/читает; обычные юзеры доступа не имеют.
-- =============================================================================

create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  payload jsonb
);

alter table public.stripe_webhook_events enable row level security;

-- RLS: запрещаем всем кроме service_role.
-- Соответствующие grant'ы для service_role даёт миграция 000011 (default privileges).
create policy "deny all on stripe_webhook_events" on public.stripe_webhook_events
  for all using (false);

create index idx_stripe_webhook_events_received on public.stripe_webhook_events(received_at desc);
