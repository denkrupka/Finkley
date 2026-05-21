-- =============================================================================
-- 20260521000021_sms_billing.sql
-- =============================================================================
-- SMS-биллинг подсистема:
--   - sms_balance / sms_paused / sms_active_sender_id на salons
--   - salon_sms_senders (приватные sender names, покупаются за 100 zł разово)
--   - salon_sms_purchases (история покупок пакетов SMS через Stripe)
--   - sms_send_log (аудит всех отправленных/skipped SMS, нужен для биллинга)
--
-- Бесплатно: 10 SMS каждому новому салону (default колонки + backfill
-- существующих салонов до 10).
-- =============================================================================

-- 1. Колонки на salons --------------------------------------------------------

alter table public.salons
  add column if not exists sms_balance integer not null default 10,
  add column if not exists sms_paused boolean not null default false,
  add column if not exists sms_active_sender_id uuid,
  add column if not exists sms_low_notified_at timestamptz;

comment on column public.salons.sms_balance is
  'Остаток SMS у салона. Default 10 = бесплатный grant для нового салона.';
comment on column public.salons.sms_paused is
  'Owner toggle — приостановить все SMS-рассылки от салона (отпуск и т.п.).';
comment on column public.salons.sms_active_sender_id is
  'NULL = FINKLEY (общий бесплатный sender). FK на salon_sms_senders.id если active.';
comment on column public.salons.sms_low_notified_at is
  'Anti-spam для low-balance notify (<3 SMS): не чаще 1/день.';

-- 2. salon_sms_senders --------------------------------------------------------

create table if not exists public.salon_sms_senders (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  sender_name text not null check (length(sender_name) between 3 and 11),
  status text not null
    check (status in ('pending_payment','pending_smsapi','active','rejected'))
    default 'pending_payment',
  price_grosz integer not null check (price_grosz > 0),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  smsapi_sender_id text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  activated_at timestamptz
);

create index if not exists idx_salon_sms_senders_salon
  on public.salon_sms_senders(salon_id, created_at desc);

create unique index if not exists idx_salon_sms_senders_unique_active
  on public.salon_sms_senders(salon_id, sender_name)
  where status <> 'rejected';

-- FK обратно на salons.sms_active_sender_id (после создания таблицы)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'salons_sms_active_sender_fkey'
  ) then
    alter table public.salons
      add constraint salons_sms_active_sender_fkey
      foreign key (sms_active_sender_id)
      references public.salon_sms_senders(id) on delete set null;
  end if;
end$$;

-- 3. salon_sms_purchases ------------------------------------------------------

create table if not exists public.salon_sms_purchases (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  package_size integer not null check (package_size > 0),
  price_per_sms_grosz integer not null check (price_per_sms_grosz > 0),
  total_grosz integer not null check (total_grosz > 0),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  status text not null
    check (status in ('pending','paid','failed','refunded'))
    default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_salon_sms_purchases_salon
  on public.salon_sms_purchases(salon_id, created_at desc);

-- 4. sms_send_log -------------------------------------------------------------

create table if not exists public.sms_send_log (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  to_phone text not null,
  sender text,
  body text not null,
  message_type text not null,                  -- 'review_request' | 'visit_reminder' | 'manual' | 'other'
  status text not null,                        -- 'sent' | 'failed' | 'skipped_no_balance' | 'skipped_paused' | 'skipped_provider'
  cost_grosz integer not null default 0,
  client_id uuid references public.clients(id) on delete set null,
  provider_response text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_send_log_salon
  on public.sms_send_log(salon_id, created_at desc);

create index if not exists idx_sms_send_log_client
  on public.sms_send_log(client_id)
  where client_id is not null;

-- 5. RLS — read only для членов салона. Все write идут через service-role в edge funcs.

alter table public.salon_sms_senders enable row level security;
alter table public.salon_sms_purchases enable row level security;
alter table public.sms_send_log enable row level security;

create policy "members read salon_sms_senders"
  on public.salon_sms_senders for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = salon_sms_senders.salon_id and sm.user_id = auth.uid()
    )
  );

create policy "members read salon_sms_purchases"
  on public.salon_sms_purchases for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = salon_sms_purchases.salon_id and sm.user_id = auth.uid()
    )
  );

create policy "members read sms_send_log"
  on public.sms_send_log for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = sms_send_log.salon_id and sm.user_id = auth.uid()
    )
  );

-- 6. Backfill: существующие салоны получают 10 SMS (default колонки уже
-- проставил всем 10, но на случай если default ещё не отработал — safety net).
update public.salons set sms_balance = 10 where sms_balance is null;
