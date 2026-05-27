-- =============================================================================
-- T42 — In-app realtime notifications
-- =============================================================================
-- Таблица для in-app push'ей: когда send-notification отправляет уведомление,
-- параллельно делается INSERT в in_app_notifications. Frontend подписан на
-- realtime postgres_changes и показывает toast при INSERT с user_id=auth.uid().
--
-- Это отдельный канал от push (browser PWA), Telegram/Email/SMS — он работает
-- только когда юзер реально в портале и не управляется notification_prefs
-- (in-app всегда on, как «status bar»; юзер может dismiss каждый toast).
-- =============================================================================

create table if not exists public.in_app_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  salon_id     uuid references public.salons(id) on delete cascade,
  type         text not null,           -- NotificationType: ai_insights, low_inventory, ...
  payload      jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_in_app_notif_user_unread
  on public.in_app_notifications(user_id, created_at desc)
  where read_at is null;

create index if not exists idx_in_app_notif_user
  on public.in_app_notifications(user_id, created_at desc);

alter table public.in_app_notifications enable row level security;

-- RLS: юзер видит и обновляет (mark read) только свои уведомления.
-- INSERT — только service_role (через send-notification Edge Function).
create policy "user reads own in-app notifications" on public.in_app_notifications
  for select using (auth.uid() = user_id);

create policy "user updates own in-app notifications" on public.in_app_notifications
  for update using (auth.uid() = user_id);

-- Включаем realtime для таблицы (Supabase Realtime через logical replication).
alter publication supabase_realtime add table public.in_app_notifications;

comment on table public.in_app_notifications is
  'T42 — in-app realtime notifications. Заполняется из send-notification Edge Function параллельно с email/tg/sms. Frontend подписывается на realtime и показывает toast.';
