# 03. Data Model

## Принципы схемы

1. **snake_case** для таблиц и колонок
2. **`bigint`** для денег в копейках/центах
3. **`timestamptz`** для всех временных меток в UTC
4. **`uuid`** для всех ID, генерация через `gen_random_uuid()`
5. **Soft delete** через `deleted_at timestamptz` (где имеет смысл сохранять историю)
6. **`created_at` + `updated_at`** на каждой таблице, `updated_at` через триггер
7. **RLS включён везде**, по умолчанию — deny
8. **Foreign keys** обязательно, с правильными `ON DELETE` стратегиями

## Логическая схема

```
auth.users (Supabase Auth)
    │
    ▼
profiles (user info)
    │
    │ N:M через salon_members
    ▼
salons ──────────────────────────┐
    │                            │
    │ 1:N                        │ 1:N
    ▼                            ▼
service_categories       expense_categories
    │                            │
    │ 1:N                        │
    ▼                            │
services                         │
    │                            │
    │ N:1 ◄──┐                   │
    ▼        │                   │
visits ─────┼───────────► clients
            │
            │ N:1
            ▼
         staff
            │
            │ 1:N
            ▼
         payouts ─► payout_lines

Отдельно:
salons → salon_subscriptions (Stripe)
salons → expenses → expense_categories
salons → integration_credentials (Booksy/wFirma — encrypted secrets)
salons → audit_log (стадия 5)
```

## Таблицы

### `profiles`

Дополнительные поля пользователя сверх `auth.users`.

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  locale text not null default 'ru',
  telegram_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy "users can update own profile"
  on profiles for update using (auth.uid() = id);

-- Триггер: создавать profile при регистрации
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

### `salons`

```sql
create table public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code text not null,            -- ISO: PL, DE, LT
  currency text not null default 'PLN',  -- ISO 4217: PLN, EUR, USD
  timezone text not null default 'Europe/Warsaw',
  salon_type text not null,              -- 'hair', 'nails', 'spa', 'barber', 'cosmetology', 'mixed'
  locale text not null default 'ru',
  logo_url text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.salons enable row level security;

create policy "members can read their salons"
  on salons for select
  using (
    id in (select salon_id from salon_members where user_id = auth.uid())
    and deleted_at is null
  );

create policy "owners can update their salons"
  on salons for update
  using (
    id in (
      select salon_id from salon_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy "anyone authenticated can create a salon"
  on salons for insert with check (auth.uid() = created_by);
```

### `salon_members`

Связь user ↔ salon с ролями.

```sql
create type salon_role as enum ('owner', 'admin', 'staff', 'accountant');

create table public.salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role salon_role not null default 'owner',
  staff_id uuid,  -- FK на staff, добавим после создания staff (циклическая ссылка)
  invited_email text,
  invited_at timestamptz,
  joined_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

alter table public.salon_members enable row level security;

create policy "members can see own membership rows"
  on salon_members for select
  using (
    user_id = auth.uid()
    or salon_id in (
      select salon_id from salon_members sm
      where sm.user_id = auth.uid() and sm.role in ('owner', 'admin')
    )
  );
```

### `service_categories` и `services`

```sql
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  category_id uuid references service_categories(id) on delete set null,
  name text not null,
  default_price_cents bigint not null default 0,
  default_duration_min int,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_categories enable row level security;
alter table public.services enable row level security;

create policy "members access service_categories" on service_categories
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create policy "members access services" on services
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));
```

### `staff` (мастера)

```sql
create type staff_payout_scheme as enum ('fixed', 'percent_revenue', 'percent_service', 'chair_rent', 'mixed');

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  full_name text not null,
  display_color text,                   -- для бейджа в UI
  payout_scheme staff_payout_scheme not null default 'percent_revenue',
  payout_fixed_cents bigint default 0,
  payout_percent numeric(5,2),
  chair_rent_cents bigint default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.staff enable row level security;

create policy "members access staff" on staff
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

-- Теперь добавляем FK на salon_members.staff_id
alter table public.salon_members
  add constraint fk_salon_members_staff
  foreign key (staff_id) references staff(id) on delete set null;

-- Стадия 2: staff_service_overrides
create table public.staff_service_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  payout_percent numeric(5,2),
  unique (staff_id, service_id)
);
```

### `clients` — стадия 2

```sql
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  birthday date,
  source text,                          -- 'instagram', 'booksy', 'walk-in', 'referral'
  tags text[] not null default '{}',    -- ['vip', 'inactive', 'new']
  notes text,
  visit_count int not null default 0,
  total_revenue_cents bigint not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.clients enable row level security;

create policy "members access clients" on clients
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create index idx_clients_salon_phone on clients(salon_id, phone) where deleted_at is null;
create index idx_clients_salon_name on clients(salon_id, lower(name)) where deleted_at is null;
```

### `visits` — главная таблица учёта выручки

```sql
create type payment_method as enum ('cash', 'card', 'transfer', 'online', 'mixed');
create type visit_status as enum ('paid', 'pending', 'cancelled');

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  service_name_snapshot text,           -- если услугу удалили, имя сохранено
  visit_at timestamptz not null,
  amount_cents bigint not null,
  tip_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  payment_method payment_method not null,
  status visit_status not null default 'paid',
  comment text,
  source text not null default 'manual',  -- 'manual', 'booksy', 'csv', 'api'
  external_id text,                       -- ID из источника
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (salon_id, source, external_id)  -- идемпотентность импортов
);

alter table public.visits enable row level security;

create policy "members access visits" on visits
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create index idx_visits_salon_date on visits(salon_id, visit_at desc) where deleted_at is null;
create index idx_visits_salon_staff on visits(salon_id, staff_id, visit_at desc) where deleted_at is null;
create index idx_visits_salon_client on visits(salon_id, client_id) where deleted_at is null;
```

### `expense_categories` и `expenses`

```sql
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  is_archived boolean not null default false,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  category_id uuid references expense_categories(id) on delete set null,
  expense_at date not null,
  amount_cents bigint not null,
  payment_method payment_method,
  comment text,
  receipt_storage_path text,
  source text not null default 'manual', -- 'manual', 'ocr', 'wfirma', 'csv'
  external_id text,
  is_recurring boolean not null default false,
  recurring_period text,
  contractor_name text,
  invoice_number text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (salon_id, source, external_id)
);

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

create policy "members access expense_categories" on expense_categories
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create policy "members access expenses" on expenses
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create index idx_expenses_salon_date on expenses(salon_id, expense_at desc) where deleted_at is null;
```

### `payouts` и `payout_lines` — стадия 2

```sql
create type payout_status as enum ('draft', 'paid');

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_revenue_cents bigint not null default 0,
  total_payout_cents bigint not null default 0,
  total_advances_cents bigint not null default 0,
  total_deductions_cents bigint not null default 0,
  net_payout_cents bigint not null default 0,
  status payout_status not null default 'draft',
  paid_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payout_lines (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references payouts(id) on delete cascade,
  visit_id uuid references visits(id) on delete set null,
  description text not null,
  amount_cents bigint not null,
  line_type text not null  -- 'visit', 'fixed', 'advance', 'deduction'
);

alter table public.payouts enable row level security;
alter table public.payout_lines enable row level security;

create policy "members access payouts" on payouts
  for all using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create policy "members access payout_lines" on payout_lines
  for all using (payout_id in (select id from payouts));
```

### `salon_subscriptions` (Stripe)

```sql
create type subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'
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

create policy "members can read own subscription" on salon_subscriptions
  for select using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

-- Запись только из edge function через service-role-key (Stripe webhook)
```

### `integration_credentials` — стадия 3

```sql
create type integration_provider as enum ('booksy', 'wfirma', 'google_calendar');

create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  provider integration_provider not null,
  encrypted_payload text not null,      -- зашифрованный JSON
  status text not null default 'active', -- 'active', 'expired', 'error'
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}', -- открытая мета (например, biz_id)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, provider)
);

alter table public.integration_credentials enable row level security;

create policy "members can see integration status" on integration_credentials
  for select using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

-- Запись/обновление — только из edge functions через service-role-key
-- encrypted_payload НИКОГДА не возвращается RLS-friendly view'ом на клиент
```

### `integration_sync_logs` — стадия 3

```sql
create table public.integration_sync_logs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  provider integration_provider not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                  -- 'success', 'partial', 'error'
  added_count int default 0,
  updated_count int default 0,
  skipped_count int default 0,
  error_message text,
  metadata jsonb default '{}'
);

alter table public.integration_sync_logs enable row level security;

create policy "members can read sync logs" on integration_sync_logs
  for select using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));
```

### `bank_connections` / `bank_accounts` / `bank_transactions` — банкинг (Enable Banking PSD2)

Импорт банковских транзакций через Enable Banking. Owner подключает свой
банк, мы тащим debits/credits и линкуем с `expenses` / `visits` /
`other_incomes`. Детали — ADR-024, формат миграций — `20260509000002*` и
`20260525130000*` / `20260525191522*`.

```sql
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  provider text not null default 'enable_banking',
  bank_aspsp_name text not null,                -- "Bank Millennium", "mBank"
  bank_country text not null,                   -- "PL", "DE", ...
  status text not null,                         -- 'pending' | 'connected' | 'expired' | 'error' | 'revoked'
  session_id text,                              -- Enable Banking session
  valid_until timestamptz,                      -- PSD2 consent истекает 90-180 дней
  last_synced_at timestamptz,
  last_error text,
  history_days int not null default 90,         -- глубина первого синка
  sync_interval_minutes int not null default 360, -- 1h/3h/6h/12h/24h (range 60..1440)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references bank_connections(id) on delete cascade,
  external_id text not null,                    -- EB account id
  iban text, name text, currency text,
  is_active boolean not null default true
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references bank_accounts(id) on delete cascade,
  external_id text not null,                    -- EB transaction id (или hash)
  type text not null check (type in ('debit', 'credit')),
  amount_cents bigint not null check (amount_cents >= 0), -- знак в type
  currency text not null,
  description text,
  counterparty text,
  executed_at timestamptz not null,
  -- Polymorphic FK — максимум одна из трёх связей одновременно:
  expense_id uuid references expenses(id) on delete set null,
  linked_visit_id uuid references visits(id) on delete set null,
  linked_other_income_id uuid references other_incomes(id) on delete set null,
  needs_review boolean not null default false,  -- low-confidence auto-match
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (account_id, external_id),
  constraint chk_bank_tx_single_link check (
    (case when expense_id is not null then 1 else 0 end) +
    (case when linked_visit_id is not null then 1 else 0 end) +
    (case when linked_other_income_id is not null then 1 else 0 end) <= 1
  )
);

-- Зеркальная колонка на expenses (для unique FK на стороне расхода)
alter table expenses
  add column bank_transaction_id uuid references bank_transactions(id) on delete set null,
  add column paid_amount_cents bigint;          -- частичные оплаты

-- IBAN для bulk-экспорта переводов (миграция 20260526002416, см. ADR-025)
alter table counterparties
  add column bank_account_iban text;            -- единый счёт контрагента
alter table scheduled_payments
  add column bank_account_iban text,            -- IBAN получателя для bulk
  add column counterparty_id uuid references counterparties(id) on delete set null;
alter table expenses
  add column bank_account_iban text;            -- OCR/KSeF auto-fill
```

RLS на всех трёх таблицах:

- `bank_connections.select` — все members салона.
- `bank_connections.for all` (insert/update/delete) — только `owner`/`admin`.
- `bank_accounts.select` — JOIN через connection → salon → salon_members.
- `bank_transactions.select` — JOIN через account → connection → salon.

Триггер `bank_tx_paid_amount_trigger` — при INSERT/UPDATE bank_transactions
с `expense_id` пересчитывает `expenses.paid_amount_cents` (сумма всех linked
debit-tx). Расход считается полностью оплаченным когда `paid_amount_cents >=
amount_cents`. Используется в UI для разделения «оплачено / не оплачено»
и для прогресс-бара частичной оплаты в форме.

Cron `cron_run_banking_syncs()` (pg_cron, `*/15 * * * *`) выбирает все
connected connections где `last_synced_at + sync_interval_minutes` истёк и
шлёт async POST на edge function `banking-sync` через pg_net.
`banking-expiry-notify` (отдельный cron) шлёт email за 7 дней до истечения
PSD2 consent — `BankingSection` показывает баннер «переподключи».

### `audit_log` — стадия 5

```sql
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

create policy "owners and admins can read audit" on audit_log
  for select using (
    salon_id in (
      select salon_id from salon_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
```

### `insights` — стадия 4

```sql
create type insight_severity as enum ('info', 'warning', 'critical');

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  kind text not null,                            -- 'unprofitable_service', 'staff_low_load', 'anomaly_revenue', ...
  area text,                                     -- 'services' | 'staff' | 'expenses' | 'revenue' (для группировки в UI)
  severity insight_severity not null default 'info',
  title text not null,
  body text,                                     -- человекочитаемое описание (после Haiku polish)
  payload jsonb,                                 -- структурированные данные правила (service_id, drop_pct, ...)
  is_dismissed boolean not null default false,
  generated_at timestamptz not null default now(),
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.insights enable row level security;

-- Раздельные политики на read и update — юзер салона может только read и
-- dismiss (через update is_dismissed), а insert/delete только service_role
-- через edge function generate-insights.
create policy "members read insights" on public.insights
  for select
  using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

create policy "members dismiss own salon insights" on public.insights
  for update
  using (salon_id in (select salon_id from salon_members where user_id = auth.uid()))
  with check (salon_id in (select salon_id from salon_members where user_id = auth.uid()));
```

**Поля, не попавшие в первую версию документа** (расхождение с миграцией
`20260505000006`, синхронизировано 8 мая): `kind` вместо `insight_type`, `body`
вместо `description`, `payload` вместо `metadata`, `severity` — enum
`insight_severity` (не text). `area` и `dismissed_at` добавлены миграцией
`20260507000012`.

## Триггеры и функции

### Универсальный `updated_at`

```sql
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Применяется ко всем таблицам с updated_at:
create trigger trg_salons_updated_at before update on salons
  for each row execute procedure set_updated_at();
create trigger trg_visits_updated_at before update on visits
  for each row execute procedure set_updated_at();
-- ... аналогично для всех остальных
```

### Денормализация `clients.visit_count` и `total_revenue_cents`

```sql
create or replace function public.recalc_client_stats()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.client_id is not null) then
    update clients set
      visit_count = visit_count + 1,
      total_revenue_cents = total_revenue_cents + new.amount_cents,
      last_visit_at = greatest(coalesce(last_visit_at, '1970-01-01'::timestamptz), new.visit_at)
    where id = new.client_id;
  elsif (tg_op = 'DELETE' and old.client_id is not null) then
    update clients set
      visit_count = greatest(0, visit_count - 1),
      total_revenue_cents = greatest(0, total_revenue_cents - old.amount_cents)
    where id = old.client_id;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_visits_client_stats
  after insert or delete on visits
  for each row execute procedure recalc_client_stats();
```

## Сидинг (seed)

При создании салона автоматически создаются дефолтные категории. Это делается в Edge Function `create-salon`, не в триггере (чтобы локализовать на язык пользователя).

Дефолтные категории расходов (RU):

- Аренда
- Зарплата мастерам
- Материалы
- Реклама
- Коммунальные услуги
- Обучение
- Прочее

Дефолтные категории услуг (зависят от `salon_type`):

- `hair`: Стрижка, Окрашивание, Укладка, Уход
- `nails`: Маникюр, Педикюр, Дизайн ногтей, Покрытие
- `spa`: Массаж, Уходовые процедуры, Косметология
- `barber`: Стрижка мужская, Бритьё, Уход за бородой
- `cosmetology`: Чистка лица, Пилинг, Уколы красоты
- `mixed`: пустой набор, заполняется владельцем

## Миграции

Все миграции — через Supabase CLI:

```bash
pnpm supabase migration new init_schema
# редактируешь файл в supabase/migrations/<timestamp>_init_schema.sql
pnpm supabase db push  # применяет к локальной БД
pnpm supabase db push --linked  # применяет к удалённой staging/production
```

Структура файлов:

```
supabase/migrations/
  20260505000001_init_auth_profiles.sql
  20260505000002_init_salons.sql
  20260505000003_init_services_staff.sql
  20260505000004_init_visits_clients.sql
  20260505000005_init_expenses.sql
  20260505000006_init_subscriptions.sql
  20260505000007_default_categories_seed_function.sql
  ... (стадия 2+)
  20260601000001_add_payouts.sql
  20260601000002_add_clients.sql
  20260701000001_add_integrations.sql
  ...
```

**Не делай миграции, которые удаляют данные без бэкапа.** На продакшен — всегда сначала `pg_dump`.

## Тестирование RLS

Обязательно покрываем тестами в `tests/rls.test.ts`:

```ts
test('user A cannot read user B salon', async () => {
  const userA = await signUp('a@test.com')
  const userB = await signUp('b@test.com')
  const salonB = await createSalon(userB.id, 'Salon B')

  const supabaseA = createClientForUser(userA.access_token)
  const { data } = await supabaseA.from('salons').select().eq('id', salonB.id).maybeSingle()

  expect(data).toBeNull() // RLS вернёт null
})
```
