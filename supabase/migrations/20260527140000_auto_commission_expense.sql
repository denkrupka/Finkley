-- =============================================================================
-- Авто-расход комиссии при оплате визита / прочего дохода / продажи (T14)
-- =============================================================================
-- При сохранении визита/дохода со status='paid' и payment_method, у которого
-- commission_pct > 0 — автоматически создаём расход в категории «Комиссии».
-- При откате оплаты (status != 'paid') — удаляем связанный расход.
--
-- Связь идёт через две новые колонки в expenses:
--   commission_source_table text — 'visits' | 'other_incomes'
--   commission_source_id   uuid — ссылка на источник
--
-- source = 'auto_commission' (отличаем от 'manual' / 'booksy' / 'banking').
-- =============================================================================

alter table public.expenses
  add column if not exists commission_source_table text,
  add column if not exists commission_source_id uuid;

create unique index if not exists idx_expenses_commission_source_unique
  on public.expenses(commission_source_table, commission_source_id)
  where commission_source_id is not null;

create index if not exists idx_expenses_commission_source
  on public.expenses(commission_source_id)
  where commission_source_id is not null;

-- ============================================================
-- Хелпер: получить commission_pct + cash_register_id метода оплаты
-- ============================================================

create or replace function public._commission_for_method(
  p_salon_id uuid,
  p_method payment_method
) returns table(commission_pct numeric, cash_register_id text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select pm.commission_pct::numeric, pm.cash_register_id
    from public.payment_methods pm
   where pm.salon_id = p_salon_id
     and pm.code = p_method
     and pm.is_archived = false
   limit 1
$$;

-- ============================================================
-- Хелпер: апсертить/удалять авто-расход комиссии для источника
-- ============================================================

create or replace function public._upsert_commission_expense(
  p_salon_id        uuid,
  p_source_table   text,
  p_source_id      uuid,
  p_paid_at        date,
  p_paid_cents     bigint,
  p_payment_method payment_method
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pct numeric := 0;
  v_amount bigint := 0;
  v_category uuid;
  v_existing_id uuid;
begin
  if p_paid_cents is null or p_paid_cents <= 0 or p_payment_method is null then
    -- Откат: если был авто-расход — удаляем.
    delete from public.expenses
     where commission_source_table = p_source_table
       and commission_source_id = p_source_id;
    return;
  end if;

  select commission_pct into v_pct
    from public._commission_for_method(p_salon_id, p_payment_method)
   limit 1;

  if v_pct is null or v_pct <= 0 then
    -- Метод без комиссии — удаляем если был.
    delete from public.expenses
     where commission_source_table = p_source_table
       and commission_source_id = p_source_id;
    return;
  end if;

  v_amount := round(p_paid_cents::numeric * v_pct / 100.0);
  if v_amount <= 0 then
    delete from public.expenses
     where commission_source_table = p_source_table
       and commission_source_id = p_source_id;
    return;
  end if;

  select id into v_category
    from public.expense_categories
   where salon_id = p_salon_id
     and is_system = true
     and name = 'Комиссии'
   limit 1;

  if v_category is null then
    -- Категория ещё не создана (тригер на новые салоны не сработал) —
    -- создаём прямо здесь, чтобы расход не потерял категорию.
    insert into public.expense_categories (salon_id, name, is_system, sort_order)
    values (p_salon_id, 'Комиссии', true, 999)
    returning id into v_category;
  end if;

  select id into v_existing_id
    from public.expenses
   where commission_source_table = p_source_table
     and commission_source_id = p_source_id
   limit 1;

  if v_existing_id is null then
    insert into public.expenses (
      salon_id, category_id, expense_at, amount_cents,
      payment_method, comment, source,
      commission_source_table, commission_source_id
    ) values (
      p_salon_id, v_category, p_paid_at, v_amount,
      p_payment_method,
      'Комиссия ' || v_pct::text || '%',
      'auto_commission',
      p_source_table, p_source_id
    );
  else
    update public.expenses
       set amount_cents = v_amount,
           expense_at = p_paid_at,
           payment_method = p_payment_method,
           category_id = v_category,
           comment = 'Комиссия ' || v_pct::text || '%',
           updated_at = now()
     where id = v_existing_id;
  end if;
end;
$$;

-- ============================================================
-- Триггеры на visits / other_incomes
-- ============================================================

create or replace function public.tg_visits_auto_commission()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_paid_cents bigint;
  v_paid_at date;
begin
  if (tg_op = 'DELETE') then
    delete from public.expenses
     where commission_source_table = 'visits'
       and commission_source_id = old.id;
    return old;
  end if;

  if new.status = 'paid' then
    v_paid_cents := coalesce(new.paid_amount_cents,
      new.amount_cents - coalesce(new.discount_cents, 0) + coalesce(new.tip_cents, 0));
    v_paid_at := (coalesce(new.visit_at, now()))::date;
    perform public._upsert_commission_expense(
      new.salon_id, 'visits', new.id, v_paid_at, v_paid_cents, new.payment_method
    );
  else
    -- Не paid — удаляем если был.
    delete from public.expenses
     where commission_source_table = 'visits'
       and commission_source_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_visits_auto_commission on public.visits;
create trigger trg_visits_auto_commission
  after insert or update or delete on public.visits
  for each row execute function public.tg_visits_auto_commission();

create or replace function public.tg_other_incomes_auto_commission()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_paid_cents bigint;
  v_paid_at date;
begin
  if (tg_op = 'DELETE') then
    delete from public.expenses
     where commission_source_table = 'other_incomes'
       and commission_source_id = old.id;
    return old;
  end if;

  v_paid_cents := coalesce(new.paid_amount_cents, new.amount_cents);
  v_paid_at := coalesce(new.income_at, now()::date);

  perform public._upsert_commission_expense(
    new.salon_id, 'other_incomes', new.id, v_paid_at, v_paid_cents, new.payment_method
  );

  return new;
end;
$$;

drop trigger if exists trg_other_incomes_auto_commission on public.other_incomes;
create trigger trg_other_incomes_auto_commission
  after insert or update or delete on public.other_incomes
  for each row execute function public.tg_other_incomes_auto_commission();

comment on function public._upsert_commission_expense(uuid, text, uuid, date, bigint, payment_method) is
  'T14 — апсертит/удаляет авто-расход комиссии для источника (visit/other_income). Учитывает payment_methods.commission_pct.';
