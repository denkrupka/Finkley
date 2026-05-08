-- Web Push subscriptions: один user × N девайсов = N rows.
-- Endpoint = идентификатор подписки (FCM/Mozilla/Apple URL); keys содержат
-- p256dh+auth для encryption payload (RFC 8291). При подписке юзер выбирает
-- один или несколько салонов, в которые хочет получать пуши (по умолчанию
-- — все, к которым у него есть доступ).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Уникальность по endpoint: повторная подписка с того же браузера
  -- — обновляем существующую запись (upsert)
  unique (endpoint)
);

create index if not exists idx_push_subs_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Юзер видит только свои подписки
create policy "own push subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
