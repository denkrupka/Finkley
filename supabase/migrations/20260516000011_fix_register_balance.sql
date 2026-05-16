-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000011_fix_register_balance.sql
--
-- Фикс compute_register_balance из 20260516000009: возвращает 0 несмотря
-- на видимые в таблице визиты с тем же cash_register_id и status='paid'.
-- Причина — комбинация `security definer` + `language sql` + multi-CTE
-- единого SELECT с case-when. Планировщик подозрительно работает с
-- инлайнингом такой формы и игнорирует условия WHERE в CTE (наблюдаемо в
-- интеграционных тестах cash-transfers-rpc).
--
-- Решение: переписать в plpgsql + security invoker. Для read-only функции
-- инвокер семантически правильнее: RLS на visits/expenses/cash_transfers
-- сам отрежет чужие салоны (membership-check был избыточен).
--
-- compute_all_register_balances оставляем plpgsql + invoker по той же
-- причине единообразия.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.compute_register_balance(uuid, text, timestamptz);

create or replace function public.compute_register_balance(
  p_salon_id uuid,
  p_register_id text,
  p_at timestamptz default now()
)
returns bigint
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_visits bigint;
  v_other bigint;
  v_in bigint;
  v_expenses bigint;
  v_payouts bigint;
  v_out bigint;
begin
  select coalesce(sum(amount_cents - discount_cents + tip_cents), 0)
    into v_visits
    from public.visits
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and status = 'paid'
      and deleted_at is null
      and visit_at <= p_at;

  select coalesce(sum(amount_cents), 0)
    into v_other
    from public.other_incomes
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and deleted_at is null
      and income_at <= p_at::date;

  select coalesce(sum(amount_cents), 0)
    into v_in
    from public.cash_transfers
    where salon_id = p_salon_id
      and to_register_id = p_register_id
      and deleted_at is null
      and transferred_at <= p_at;

  select coalesce(sum(amount_cents), 0)
    into v_expenses
    from public.expenses
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and deleted_at is null
      and expense_at <= p_at::date;

  select coalesce(sum(net_payout_cents), 0)
    into v_payouts
    from public.payouts
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and status = 'paid';

  select coalesce(sum(amount_cents), 0)
    into v_out
    from public.cash_transfers
    where salon_id = p_salon_id
      and from_register_id = p_register_id
      and deleted_at is null
      and transferred_at <= p_at;

  return v_visits + v_other + v_in - v_expenses - v_payouts - v_out;
end;
$$;

revoke all on function public.compute_register_balance(uuid, text, timestamptz) from public;
grant execute on function public.compute_register_balance(uuid, text, timestamptz) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- compute_all_register_balances — тот же фикс (invoker, RLS защищает доступ)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.compute_all_register_balances(uuid, timestamptz);

create or replace function public.compute_all_register_balances(
  p_salon_id uuid,
  p_at timestamptz default now()
)
returns table (register_id text, balance_cents bigint)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registers jsonb;
begin
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

revoke all on function public.compute_all_register_balances(uuid, timestamptz) from public;
grant execute on function public.compute_all_register_balances(uuid, timestamptz) to authenticated;
