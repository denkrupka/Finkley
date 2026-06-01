-- ai_create_visit + ai_create_expense — VAT auto-defaults
--
-- AI-помощник дёргает эти RPC из чата («Запиши расход 1230 PLN за аренду»).
-- Без VAT-полей P&L по этим записям не вычитает VAT-обязательство. Здесь
-- добавляем внутри функций авто-расчёт нетто+ставки если salon — VAT-плательщик.
-- Signature не меняется (backwards-compat для AI-помощника).
--
-- Логика:
--   IF salon vat_payer = true AND p_amount_cents > 0:
--     v_rate = defaultVatRate(country)  (PL=23, DE=19, UA=20, CZ=21, LT=21)
--     v_net  = round(amount * 100 / (100 + rate))
--     записываем в expenses.amount_net_cents / vat_rate_pct / vat_skipped=false
--   ELSE: оставляем null (P&L fallback на gross)

create or replace function public._default_vat_rate(p_country text)
returns numeric
language sql
immutable
as $$
  select case upper(coalesce(p_country, 'PL'))
    when 'PL' then 23
    when 'DE' then 19
    when 'UA' then 20
    when 'CZ' then 21
    when 'LT' then 21
    else 23
  end::numeric
$$;

-- ai_create_visit — replace с VAT-autofill
create or replace function public.ai_create_visit(
  p_user_id uuid,
  p_salon_id uuid,
  p_staff_id uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_amount_cents bigint,
  p_payment_method text,
  p_visit_at timestamptz default null,
  p_comment text default null
)
returns public.visits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.visits;
  v_method text;
  v_vat_payer boolean;
  v_country text;
  v_rate numeric;
  v_net bigint;
begin
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  begin
    v_method := p_payment_method::text;
  exception when others then
    raise exception 'invalid payment_method: %', p_payment_method using errcode = '22023';
  end;

  if p_staff_id is not null and not exists (
    select 1 from public.staff where id = p_staff_id and salon_id = p_salon_id
  ) then
    raise exception 'staff not in salon' using errcode = '22023';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients where id = p_client_id and salon_id = p_salon_id
  ) then
    raise exception 'client not in salon' using errcode = '22023';
  end if;
  if p_service_id is not null and not exists (
    select 1 from public.services where id = p_service_id and salon_id = p_salon_id
  ) then
    raise exception 'service not in salon' using errcode = '22023';
  end if;

  -- VAT autofill — читаем vat_payer + country один раз.
  select (accounting_settings->>'vat_payer')::boolean, country_code
    into v_vat_payer, v_country
    from public.salons where id = p_salon_id;

  if coalesce(v_vat_payer, false) then
    v_rate := public._default_vat_rate(v_country);
    v_net := round(p_amount_cents * 100.0 / (100 + v_rate));
  else
    v_rate := null;
    v_net := null;
  end if;

  insert into public.visits (
    salon_id, staff_id, client_id, service_id,
    visit_at, amount_cents, payment_method, status,
    comment, source, created_by,
    amount_net_cents, vat_rate_pct, vat_skipped
  ) values (
    p_salon_id, p_staff_id, p_client_id, p_service_id,
    coalesce(p_visit_at, now()), p_amount_cents, v_method, 'paid',
    p_comment, 'ai_assistant', p_user_id,
    v_net, v_rate, case when v_vat_payer then false else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ai_create_visit(uuid, uuid, uuid, uuid, uuid, bigint, text, timestamptz, text) from public;
grant execute on function public.ai_create_visit(uuid, uuid, uuid, uuid, uuid, bigint, text, timestamptz, text) to service_role;

-- ai_create_expense — replace с VAT-autofill
create or replace function public.ai_create_expense(
  p_user_id uuid,
  p_salon_id uuid,
  p_category_id uuid,
  p_amount_cents bigint,
  p_expense_at date,
  p_comment text default null,
  p_contractor_name text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.expenses;
  v_vat_payer boolean;
  v_country text;
  v_rate numeric;
  v_net bigint;
begin
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden: owner/admin only' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.expense_categories
    where id = p_category_id and salon_id = p_salon_id
  ) then
    raise exception 'category not in salon' using errcode = '22023';
  end if;

  -- VAT autofill
  select (accounting_settings->>'vat_payer')::boolean, country_code
    into v_vat_payer, v_country
    from public.salons where id = p_salon_id;

  if coalesce(v_vat_payer, false) then
    v_rate := public._default_vat_rate(v_country);
    v_net := round(p_amount_cents * 100.0 / (100 + v_rate));
  else
    v_rate := null;
    v_net := null;
  end if;

  insert into public.expenses (
    salon_id, category_id, expense_at, amount_cents,
    comment, contractor_name, source, created_by,
    amount_net_cents, vat_rate_pct
  ) values (
    p_salon_id, p_category_id, coalesce(p_expense_at, current_date), p_amount_cents,
    p_comment, p_contractor_name, 'ai_assistant', p_user_id,
    v_net, v_rate
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ai_create_expense(uuid, uuid, uuid, bigint, date, text, text) from public;
grant execute on function public.ai_create_expense(uuid, uuid, uuid, bigint, date, text, text) to service_role;
