-- =============================================================================
-- 20260505000006_init_subscriptions_integrations.sql
-- =============================================================================
-- salon_subscriptions (Stripe) + integration_credentials (Booksy/wFirma)
-- + insights (стадия 4) + audit_log (стадия 5)
-- =============================================================================

-- Subscriptions
create type subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete',
  'incomplete_expired', 'unpaid', 'paused'
);

create table public.salon_subscriptions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null unique references salons(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  status subscription_status not null,
  trial_ends_at timestamptz,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.salon_subscriptions enable row level security;

create trigger trg_salon_subscriptions_updated_at
  before update on salon_subscriptions
  for each row execute procedure public.set_updated_at();

-- Только чтение членам, запись через service-role-key из stripe-webhook
create policy "members can read own subscription" on salon_subscriptions
  for select using (
    salon_id in (select salon_id from salon_members where user_id = auth.uid())
  );


-- Integration credentials (encrypted secrets — Booksy, wFirma)
create type integration_provider as enum ('booksy', 'wfirma', 'google_calendar');

create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  provider integration_provider not null,
  encrypted_payload text not null,
  status text not null default 'active',
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, provider)
);

alter table public.integration_credentials enable row level security;

create trigger trg_integration_credentials_updated_at
  before update on integration_credentials
  for each row execute procedure public.set_updated_at();

-- Юзер видит только статус через view, не encrypted_payload
create view public.integration_status as
  select id, salon_id, provider, status, last_sync_at, last_error,
         metadata, created_at, updated_at
  from integration_credentials;

-- Прямой доступ к таблице запрещён, читаем через view
create policy "deny direct read on credentials" on integration_credentials
  for select using (false);

grant select on public.integration_status to authenticated;


-- Insights (стадия 4) — заранее готовим
create type insight_severity as enum ('info', 'warning', 'critical');

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  kind text not null,
  severity insight_severity not null default 'info',
  title text not null,
  body text,
  payload jsonb,
  is_dismissed boolean not null default false,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.insights enable row level security;

create policy "members access insights" on insights for all using (
  salon_id in (select salon_id from salon_members where user_id = auth.uid())
);


-- Audit log (стадия 5) — заранее готовим
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  diff jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "owners and admins can read audit" on audit_log for select using (
  salon_id in (
    select salon_id from salon_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  )
);
