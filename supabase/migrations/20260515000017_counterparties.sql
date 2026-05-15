-- Контрагенты (поставщики/контрагенты) — на кого расход выписан.
-- По запросу владельца (image #93): в ExpenseFormModal должно быть поле
-- «Контрагент» — выпадающий список из справочника, с возможностью
-- inline-добавления. Контрагент имеет имя, NIP (Польша), адрес и категорию.
-- Категория контрагента — отдельная мини-таблица для группировки
-- (косметика-поставщик, аренда, коммуналка, реклама и т.д.).
--
-- Поиск по NIP через Data PORT работает на этапе создания контрагента —
-- юзер вводит NIP, фронт дёргает edge function, заполняются остальные поля.

create table if not exists public.counterparty_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (salon_id, name)
);
comment on table public.counterparty_categories is
  'Категории контрагентов (поставщики, аренда, услуги, и т.д.). Per-salon.';

create index if not exists idx_cp_cats_salon
  on public.counterparty_categories(salon_id)
  where archived_at is null;

create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  nip text,
  address text,
  category_id uuid references public.counterparty_categories(id) on delete set null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.counterparties is
  'Контрагенты салона: поставщики, арендодатели, подрядчики. Используются в expenses.counterparty_id.';

create index if not exists idx_cp_salon on public.counterparties(salon_id) where archived_at is null;
create index if not exists idx_cp_nip on public.counterparties(salon_id, nip) where nip is not null;

-- updated_at trigger — используем общий set_updated_at из init-миграции.
create trigger tg_counterparties_updated_at
  before update on public.counterparties
  for each row execute function public.set_updated_at();

-- ── Expense FK ───────────────────────────────────────────────────────────
alter table public.expenses
  add column if not exists counterparty_id uuid references public.counterparties(id) on delete set null,
  add column if not exists document_number text;
comment on column public.expenses.counterparty_id is
  'FK на counterparties — кому выписан расход. NULL если контрагент не указан.';
comment on column public.expenses.document_number is
  'Номер документа (фактура/чек), либо введён вручную, либо распознан OCR с фото.';

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.counterparty_categories enable row level security;
alter table public.counterparties enable row level security;

-- Помощник: пользователь видит только свои салоны через salon_members.
-- Используем тот же паттерн что для expense_categories и других справочников.
create policy "cp_cats_select"
  on public.counterparty_categories for select
  using (
    exists (
      select 1 from public.salon_members m
      where m.salon_id = counterparty_categories.salon_id
        and m.user_id = auth.uid()
    )
  );
create policy "cp_cats_modify"
  on public.counterparty_categories for all
  using (
    exists (
      select 1 from public.salon_members m
      where m.salon_id = counterparty_categories.salon_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

create policy "cp_select"
  on public.counterparties for select
  using (
    exists (
      select 1 from public.salon_members m
      where m.salon_id = counterparties.salon_id
        and m.user_id = auth.uid()
    )
  );
create policy "cp_modify"
  on public.counterparties for all
  using (
    exists (
      select 1 from public.salon_members m
      where m.salon_id = counterparties.salon_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'accountant')
    )
  );
