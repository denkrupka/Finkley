-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000009_cash_transfers.sql
--
-- Перестановка средств между кассами (см. decisions/014-cash-transfers.md).
--
-- Касса салона — это не одно «место». Деньги переходят между «Касса
-- наличка» → «Сейф» → «Банковский счёт» → обратно. Эти операции — НЕ
-- расходы и НЕ доходы, это внутренние перемещения. Должны быть учтены, но
-- не должны влиять на P&L и категории расходов.
--
-- Концепция:
--   • cash_transfers — независимая первичная сущность с from/to registers
--   • compute_register_balance — per-register балансы для UI карточек
--   • reversal_of — связь обратного перевода с оригиналом (undo-toast)
--   • soft-delete — только owner/admin, с обязательной причиной + создаёт
--     дополнительный reversal-transfer для корректности балансов
--
-- ВАЖНО: cash_registers хранятся в salons.financial_settings.cash_registers
-- (JSONB), не отдельная таблица. Поэтому from_register_id/to_register_id —
-- text, без FK. Lookup label по id делается на клиенте.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Таблица cash_transfers
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cash_transfers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,

  from_register_id text not null,
  to_register_id   text not null,

  amount_cents bigint not null check (amount_cents > 0),
  comment text,
  transferred_at timestamptz not null default now(),

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Если эта запись — обратный перевод, ссылается на оригинал.
  reversal_of uuid references public.cash_transfers(id) on delete set null,

  -- Soft-delete: только owner/admin через RPC, с обязательной причиной.
  -- Оригинал НЕ удаляется физически — рядом создаётся reversal-запись.
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_reason text,

  check (from_register_id <> to_register_id)
);

comment on table public.cash_transfers is
  'Внутренние перемещения денег между cash_registers. НЕ влияет на P&L. См. ADR-014.';

-- Индексы под compute_register_balance (две стороны перевода)
create index if not exists idx_cash_transfers_salon_from
  on public.cash_transfers(salon_id, from_register_id, transferred_at)
  where deleted_at is null;

create index if not exists idx_cash_transfers_salon_to
  on public.cash_transfers(salon_id, to_register_id, transferred_at)
  where deleted_at is null;

-- История по убыванию даты (для таблицы под формой)
create index if not exists idx_cash_transfers_salon_history
  on public.cash_transfers(salon_id, transferred_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cash_transfers enable row level security;

-- Все members салона видят все трансферы (для аудита).
create policy "cash_transfers_select" on public.cash_transfers
  for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = cash_transfers.salon_id
        and sm.user_id = auth.uid()
    )
  );

-- Insert только через RPC cash_transfer_create (там валидация баланса).
-- Прямой insert с клиента запрещён.
create policy "cash_transfers_insert_via_rpc_only" on public.cash_transfers
  for insert to authenticated
  with check (false);

-- Update только через RPC cash_transfer_soft_delete.
-- Прямой update с клиента запрещён.
create policy "cash_transfers_update_via_rpc_only" on public.cash_transfers
  for update to authenticated
  using (false);

-- Delete запрещён полностью — только soft через RPC.
-- Нет политики delete → дефолтно запрещено.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Расширение схемы: cash_register_id на other_incomes и payouts
-- ─────────────────────────────────────────────────────────────────────────────
--
-- На other_incomes и payouts колонки нет (на сегодня). Добавляем nullable —
-- compute_register_balance будет уже учитывать эти потоки, как только UI
-- начнёт заполнять поле. Сейчас все значения NULL — счётчик 0, не ломает
-- существующее.

alter table public.other_incomes
  add column if not exists cash_register_id text;
comment on column public.other_incomes.cash_register_id is
  'ID кассы из financial_settings.cash_registers.items[]. Опциональное поле для per-register балансов (см. ADR-014).';

alter table public.payouts
  add column if not exists cash_register_id text;
comment on column public.payouts.cash_register_id is
  'ID кассы откуда выплачена ЗП. Опционально, для per-register балансов (см. ADR-014).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: compute_register_balance
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Возвращает текущий баланс конкретной кассы в копейках на указанный момент.
-- Формула:
--   + visits с этой кассой (status=paid) — net (amount - discount + tip)
--   + other_incomes с этой кассой
--   + cash_transfers поступившие (to = X)
--   − expenses с этой кассой
--   − payouts paid с этой кассой
--   − cash_transfers ушедшие (from = X)
--
-- Soft-deleted записи (deleted_at != null) не учитываются.

create or replace function public.compute_register_balance(
  p_salon_id uuid,
  p_register_id text,
  p_at timestamptz default now()
)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with members_check as (
    -- Доступ только members салона
    select 1 from public.salon_members
    where salon_id = p_salon_id and user_id = auth.uid()
  ),
  visits_in as (
    select coalesce(sum(amount_cents - discount_cents + tip_cents), 0) as v
    from public.visits
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and status = 'paid'
      and deleted_at is null
      and visit_at <= p_at
  ),
  other_in as (
    select coalesce(sum(amount_cents), 0) as v
    from public.other_incomes
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and deleted_at is null
      and income_at <= p_at::date
  ),
  transfers_in as (
    select coalesce(sum(amount_cents), 0) as v
    from public.cash_transfers
    where salon_id = p_salon_id
      and to_register_id = p_register_id
      and deleted_at is null
      and transferred_at <= p_at
  ),
  expenses_out as (
    select coalesce(sum(amount_cents), 0) as v
    from public.expenses
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and deleted_at is null
      and expense_at <= p_at::date
  ),
  payouts_out as (
    select coalesce(sum(net_payout_cents), 0) as v
    from public.payouts
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and status = 'paid'
  ),
  transfers_out as (
    select coalesce(sum(amount_cents), 0) as v
    from public.cash_transfers
    where salon_id = p_salon_id
      and from_register_id = p_register_id
      and deleted_at is null
      and transferred_at <= p_at
  )
  select
    case when exists (select 1 from members_check) then
      (select v from visits_in)
      + (select v from other_in)
      + (select v from transfers_in)
      - (select v from expenses_out)
      - (select v from payouts_out)
      - (select v from transfers_out)
    else
      null
    end;
$$;

comment on function public.compute_register_balance is
  'Per-register баланс на момент времени. SECURITY DEFINER + явная проверка членства (см. ADR-014).';

revoke all on function public.compute_register_balance(uuid, text, timestamptz) from public;
grant execute on function public.compute_register_balance(uuid, text, timestamptz) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: cash_transfer_create
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Atomic create с проверкой баланса источника. SECURITY DEFINER чтобы обойти
-- RLS insert=false (политика не пускает direct insert, только через эту RPC).

create or replace function public.cash_transfer_create(
  p_salon_id uuid,
  p_from text,
  p_to text,
  p_amount_cents bigint,
  p_comment text default null,
  p_transferred_at timestamptz default null
)
returns public.cash_transfers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := coalesce(p_transferred_at, now());
  v_balance bigint;
  v_row public.cash_transfers;
begin
  -- Проверка членства в салоне
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id and user_id = v_uid
  ) then
    raise exception 'forbidden: not a salon member' using errcode = '42501';
  end if;

  -- Валидация полей
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid amount: must be > 0' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or length(p_from) = 0 or length(p_to) = 0 then
    raise exception 'from/to registers required' using errcode = '22023';
  end if;
  if p_from = p_to then
    raise exception 'from and to registers must differ' using errcode = '22023';
  end if;

  -- Проверка баланса источника (на момент даты операции)
  v_balance := public.compute_register_balance(p_salon_id, p_from, v_at);
  if v_balance is null then
    raise exception 'forbidden: balance access denied' using errcode = '42501';
  end if;
  if v_balance < p_amount_cents then
    raise exception 'insufficient balance in source register: % < %', v_balance, p_amount_cents
      using errcode = '23514';
  end if;

  -- Запись (обходим RLS insert=false через SECURITY DEFINER)
  insert into public.cash_transfers (
    salon_id, from_register_id, to_register_id,
    amount_cents, comment, transferred_at, created_by
  ) values (
    p_salon_id, p_from, p_to,
    p_amount_cents, p_comment, v_at, v_uid
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.cash_transfer_create is
  'Atomic create трансфера с проверкой баланса источника. См. ADR-014.';

revoke all on function public.cash_transfer_create(uuid, text, text, bigint, text, timestamptz) from public;
grant execute on function public.cash_transfer_create(uuid, text, text, bigint, text, timestamptz) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC: cash_transfer_reverse
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Создаёт обратный перевод с reversal_of = id оригинала. Используется в
-- undo-toast «Откатить (8 сек)». Также проверяет баланс новой стороны
-- источника (т.е. где раньше «to», теперь «from»).

create or replace function public.cash_transfer_reverse(
  p_id uuid
)
returns public.cash_transfers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_orig public.cash_transfers;
  v_balance bigint;
  v_row public.cash_transfers;
begin
  select * into v_orig from public.cash_transfers where id = p_id;
  if v_orig.id is null then
    raise exception 'transfer not found' using errcode = '22023';
  end if;

  -- Доступ — member салона
  if not exists (
    select 1 from public.salon_members
    where salon_id = v_orig.salon_id and user_id = v_uid
  ) then
    raise exception 'forbidden: not a salon member' using errcode = '42501';
  end if;

  -- Нельзя реверсить уже удалённую запись
  if v_orig.deleted_at is not null then
    raise exception 'cannot reverse deleted transfer' using errcode = '22023';
  end if;

  -- Нельзя реверсить запись, которая уже сама является реверсалом (двойной откат)
  if v_orig.reversal_of is not null then
    raise exception 'cannot reverse a reversal transfer' using errcode = '22023';
  end if;

  -- Нельзя реверсить если уже есть активный реверсал
  if exists (
    select 1 from public.cash_transfers
    where reversal_of = p_id and deleted_at is null
  ) then
    raise exception 'transfer already reversed' using errcode = '22023';
  end if;

  -- Проверка баланса новой стороны источника
  v_balance := public.compute_register_balance(v_orig.salon_id, v_orig.to_register_id);
  if v_balance < v_orig.amount_cents then
    raise exception 'insufficient balance in destination register for reversal: % < %', v_balance, v_orig.amount_cents
      using errcode = '23514';
  end if;

  insert into public.cash_transfers (
    salon_id, from_register_id, to_register_id,
    amount_cents, comment, transferred_at, created_by, reversal_of
  ) values (
    v_orig.salon_id, v_orig.to_register_id, v_orig.from_register_id,
    v_orig.amount_cents,
    case when v_orig.comment is not null then '↩ ' || v_orig.comment else '↩ reversal' end,
    now(), v_uid, p_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.cash_transfer_reverse is
  'Создаёт reversal-перевод для undo. См. ADR-014.';

revoke all on function public.cash_transfer_reverse(uuid) from public;
grant execute on function public.cash_transfer_reverse(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: cash_transfer_soft_delete
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Только owner/admin. Помечает оригинал как deleted + создаёт обратный
-- transfer (как и reverse). В таблице остаются обе записи: оригинал с
-- deleted_at/by/reason + reversal с reversal_of.

create or replace function public.cash_transfer_soft_delete(
  p_id uuid,
  p_reason text
)
returns public.cash_transfers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_orig public.cash_transfers;
  v_balance bigint;
  v_reversal public.cash_transfers;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason required' using errcode = '22023';
  end if;

  select * into v_orig from public.cash_transfers where id = p_id;
  if v_orig.id is null then
    raise exception 'transfer not found' using errcode = '22023';
  end if;

  -- Только owner/admin
  if not exists (
    select 1 from public.salon_members
    where salon_id = v_orig.salon_id
      and user_id = v_uid
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if v_orig.deleted_at is not null then
    raise exception 'already deleted' using errcode = '22023';
  end if;

  -- Если у оригинала уже есть активный реверсал — не дублируем,
  -- просто помечаем deleted_at без создания второго reversal.
  if exists (
    select 1 from public.cash_transfers
    where reversal_of = p_id and deleted_at is null
  ) then
    update public.cash_transfers
    set deleted_at = now(), deleted_by = v_uid, deleted_reason = p_reason
    where id = p_id
    returning * into v_orig;
    return v_orig;
  end if;

  -- Проверка баланса для reversal
  v_balance := public.compute_register_balance(v_orig.salon_id, v_orig.to_register_id);
  if v_balance < v_orig.amount_cents then
    raise exception 'insufficient balance in destination register for delete-reversal: % < %', v_balance, v_orig.amount_cents
      using errcode = '23514';
  end if;

  -- Создаём reversal
  insert into public.cash_transfers (
    salon_id, from_register_id, to_register_id,
    amount_cents, comment, transferred_at, created_by, reversal_of
  ) values (
    v_orig.salon_id, v_orig.to_register_id, v_orig.from_register_id,
    v_orig.amount_cents,
    '🗑 ' || coalesce(p_reason, 'удалено'),
    now(), v_uid, p_id
  )
  returning * into v_reversal;

  -- Помечаем оригинал deleted
  update public.cash_transfers
  set deleted_at = now(), deleted_by = v_uid, deleted_reason = p_reason
  where id = p_id
  returning * into v_orig;

  return v_orig;
end;
$$;

comment on function public.cash_transfer_soft_delete is
  'Soft-delete оригинала + создание reversal. Только owner/admin. См. ADR-014.';

revoke all on function public.cash_transfer_soft_delete(uuid, text) from public;
grant execute on function public.cash_transfer_soft_delete(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Bulk-балансы: одним запросом для всех касс салона
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Для UI карточек касс (в модалке) нужно получить балансы всех активных
-- registers одним вызовом, чтобы не делать N round-trip'ов.

create or replace function public.compute_all_register_balances(
  p_salon_id uuid,
  p_at timestamptz default now()
)
returns table (register_id text, balance_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_registers jsonb;
begin
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id and user_id = v_uid
  ) then
    raise exception 'forbidden: not a salon member' using errcode = '42501';
  end if;

  -- Достаём список активных register_id из financial_settings
  select coalesce(
    (
      select jsonb_agg(elem->'id')
      from public.salons s,
           jsonb_array_elements(s.financial_settings->'cash_registers'->'items') elem
      where s.id = p_salon_id
        and coalesce((elem->>'archived')::boolean, false) = false
    ),
    '[]'::jsonb
  )
  into v_registers;

  return query
  select
    rid::text as register_id,
    public.compute_register_balance(p_salon_id, rid::text, p_at) as balance_cents
  from jsonb_array_elements_text(v_registers) rid;
end;
$$;

comment on function public.compute_all_register_balances is
  'Bulk per-register балансы для UI карточек. См. ADR-014.';

revoke all on function public.compute_all_register_balances(uuid, timestamptz) from public;
grant execute on function public.compute_all_register_balances(uuid, timestamptz) to authenticated;
