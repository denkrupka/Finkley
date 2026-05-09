-- =============================================================================
-- 20260509000002_bank_integration.sql
-- =============================================================================
-- Интеграция с Enable Banking (PSD2 AIS).
--
-- Один салон может подключать несколько банков (table bank_connections, N:N).
-- В каждом подключении — несколько привязанных аккаунтов (bank_accounts).
-- Транзакции тащим в bank_transactions (raw audit-trail).
--
-- Расходы (debits) при синке автоматически создают строку в expenses со
-- ссылкой на bank_transaction_id. Дедуп — по уникальному (account_id,
-- external_id) на bank_transactions, и FK-ссылке на expenses (один к одному).
--
-- Credits сохраняем в bank_transactions, но в expenses не пишем — они
-- видны как «доходы по банку» в отдельном виджете (планируется).
-- =============================================================================

-- ─── bank_connections ──────────────────────────────────────────────────────
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  provider text not null default 'enable_banking',

  -- Enable Banking session (после успешного auth)
  session_id text,
  -- aspsp = ASPSP (Account Servicing Payment Service Provider) — банк
  bank_name text,                  -- "Bank Millennium" (отображаемое)
  bank_aspsp_name text,            -- machine-name из EB API
  bank_country text,               -- "PL", "UA", "DE" — ISO 3166-1 alpha-2
  history_days int not null default 90,  -- сколько дней истории при первом синке

  status text not null default 'pending'
    check (status in ('pending', 'connected', 'expired', 'revoked', 'error')),
  -- Срок действия consent'а юзера. После — нужен re-auth (PSD2 SCA).
  valid_until timestamptz,
  last_synced_at timestamptz,
  last_error text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_bank_connections_salon on public.bank_connections(salon_id);
create index idx_bank_connections_status on public.bank_connections(status)
  where status = 'connected';
-- Cron-helper: какие connection'ы скоро истекут (для email-нотификации).
create index idx_bank_connections_valid_until on public.bank_connections(valid_until)
  where status = 'connected' and valid_until is not null;

create trigger trg_bank_connections_updated_at
  before update on public.bank_connections
  for each row execute procedure public.set_updated_at();

alter table public.bank_connections enable row level security;

create policy "bank_connections_select" on public.bank_connections
  for select using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );
create policy "bank_connections_modify_owner" on public.bank_connections
  for all using (
    salon_id in (
      select salon_id from public.salon_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    salon_id in (
      select salon_id from public.salon_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ─── bank_accounts ─────────────────────────────────────────────────────────
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  -- Уникальный id аккаунта со стороны Enable Banking
  external_id text not null,
  iban text,
  name text,
  currency text,                   -- ISO 4217: "PLN", "EUR"
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id)
);

create index idx_bank_accounts_connection on public.bank_accounts(connection_id)
  where is_active = true;

create trigger trg_bank_accounts_updated_at
  before update on public.bank_accounts
  for each row execute procedure public.set_updated_at();

alter table public.bank_accounts enable row level security;

create policy "bank_accounts_select" on public.bank_accounts
  for select using (
    connection_id in (
      select id from public.bank_connections
       where salon_id in (
         select salon_id from public.salon_members where user_id = auth.uid()
       )
    )
  );

-- ─── bank_transactions ─────────────────────────────────────────────────────
-- Сырой audit-trail импортов из банка. Один к одному с EB transactions.
create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  -- EB transaction id (или хеш если EB id отсутствует — fallback)
  external_id text not null,
  type text not null check (type in ('debit', 'credit')),
  -- amount_cents всегда положительный; направление в type
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null,
  description text,
  counterparty text,               -- название контрагента (если есть)
  executed_at timestamptz not null,
  -- Если debit — auto-создаём expense, ссылку держим тут.
  expense_id uuid references public.expenses(id) on delete set null,
  raw jsonb,                       -- сырой ответ EB для аудита/дебага
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);

create index idx_bank_transactions_account_executed on public.bank_transactions(account_id, executed_at desc);
create index idx_bank_transactions_expense on public.bank_transactions(expense_id)
  where expense_id is not null;

alter table public.bank_transactions enable row level security;

create policy "bank_transactions_select" on public.bank_transactions
  for select using (
    account_id in (
      select id from public.bank_accounts
       where connection_id in (
         select id from public.bank_connections
          where salon_id in (
            select salon_id from public.salon_members where user_id = auth.uid()
          )
       )
    )
  );

-- ─── expenses.bank_transaction_id (обратная ссылка) ────────────────────────
alter table public.expenses
  add column if not exists bank_transaction_id uuid
    references public.bank_transactions(id) on delete set null;

create index if not exists idx_expenses_bank_tx
  on public.expenses(bank_transaction_id)
  where bank_transaction_id is not null;

-- ─── seed-категория «Банк» для импорта без явной категории ────────────────
-- Создавать не обязательно: edge function сам делает upsert по имени.
-- Юзер потом может переименовать/раскидать руками.

comment on table public.bank_connections is
  'Подключение банка через Enable Banking (PSD2 AIS). Один салон может иметь несколько подключений.';
comment on table public.bank_accounts is
  'Привязанные аккаунты внутри банковского подключения. EB linked account.';
comment on table public.bank_transactions is
  'Сырые транзакции из банка. Дедуп по (account_id, external_id). Debits авто-создают expenses.';
comment on column public.bank_connections.history_days is
  'Сколько дней истории тащить при первом синке. Min 30, max 730 (зависит от банка).';
comment on column public.bank_connections.valid_until is
  'Срок действия PSD2-consent. По истечении нужен re-auth (SCA через банк).';
