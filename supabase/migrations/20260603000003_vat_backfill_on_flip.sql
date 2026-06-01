-- Backfill VAT-полей при флипе salons.accounting_settings.vat_payer → true.
--
-- Сценарий: юзер месяц копил данные без VAT (vat_payer=false), потом
-- включил «я плательщик VAT». До этой миграции старые записи (visits/
-- expenses/other_incomes/scheduled_payments) оставались с null
-- amount_net_cents/vat_rate_pct → P&L vatBreakdownFor fallback на
-- gross→net, vat=0 → строка «НДС к оплате» теряла VAT с накопленной
-- истории.
--
-- Решение: расширяем trigger salons_vat_payer_to_taxes_cat (миграция
-- 20260602000002) — он уже срабатывает на флип. Добавляем backfill
-- за 90 дней по country-default ставке. Только для записей где
-- amount_net_cents IS NULL (не трогаем уже выставленные).
--
-- Логика расчёта нетто такая же как в _default_vat_rate +
-- round(amount * 100 / (100+rate)) — совпадает с TS computeNet.
--
-- ВАЖНО: backfill использует defaultVatRate без учёта типа категории.
-- Для payroll-расходов (зарплата мастеру) это даст ложный 23% VAT,
-- хотя зарплата не подпадает под VAT. Лечится отдельным фильтром
-- по категориям ниже.

create or replace function public.backfill_vat_for_salon(p_salon_id uuid)
returns table (
  visits_updated int,
  retail_updated int,
  other_incomes_updated int,
  expenses_updated int,
  scheduled_updated int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text;
  v_rate numeric;
  v_cutoff date := current_date - interval '90 days';
  v_visits int := 0;
  v_retail int := 0;
  v_other  int := 0;
  v_exp    int := 0;
  v_sch    int := 0;
begin
  select country_code into v_country
    from public.salons where id = p_salon_id;
  v_rate := public._default_vat_rate(v_country);

  -- visits: kind='visit' и kind='retail' оба покрываются одним UPDATE.
  -- vat_skipped = false (юзер начал отчитываться, считаем все доходы
  -- VAT-able по дефолту страны).
  update public.visits
     set amount_net_cents = round(amount_cents * 100.0 / (100 + v_rate)),
         vat_rate_pct = v_rate,
         vat_skipped = false
   where salon_id = p_salon_id
     and amount_net_cents is null
     and amount_cents > 0
     and visit_at >= v_cutoff
     and deleted_at is null
     and kind = 'visit';
  get diagnostics v_visits = row_count;

  update public.visits
     set amount_net_cents = round(amount_cents * 100.0 / (100 + v_rate)),
         vat_rate_pct = v_rate,
         vat_skipped = false
   where salon_id = p_salon_id
     and amount_net_cents is null
     and amount_cents > 0
     and visit_at >= v_cutoff
     and deleted_at is null
     and kind = 'retail';
  get diagnostics v_retail = row_count;

  update public.other_incomes
     set amount_net_cents = round(amount_cents * 100.0 / (100 + v_rate)),
         vat_rate_pct = v_rate,
         vat_skipped = false
   where salon_id = p_salon_id
     and amount_net_cents is null
     and amount_cents > 0
     and income_at >= v_cutoff
     and deleted_at is null;
  get diagnostics v_other = row_count;

  -- expenses: исключаем payroll-категории (зарплата/комиссия не VAT-able).
  -- Определяем по name категории — system-категории «Зарплата» создаются
  -- в onboarding с фиксированным именем.
  update public.expenses e
     set amount_net_cents = round(e.amount_cents * 100.0 / (100 + v_rate)),
         vat_rate_pct = v_rate
   where e.salon_id = p_salon_id
     and e.amount_net_cents is null
     and e.amount_cents > 0
     and e.expense_at >= v_cutoff
     and e.deleted_at is null
     and (e.source is null or e.source not in ('auto_commission', 'payout'))
     and not exists (
       select 1 from public.expense_categories c
        where c.id = e.category_id
          and (c.name ilike 'зарплат%' or c.name ilike 'salary%' or c.name ilike 'wynagrodze%')
     );
  get diagnostics v_exp = row_count;

  update public.scheduled_payments
     set amount_net_cents = round(amount_cents * 100.0 / (100 + v_rate)),
         vat_rate_pct = v_rate
   where salon_id = p_salon_id
     and amount_net_cents is null
     and amount_cents > 0
     and due_date >= v_cutoff
     and deleted_at is null
     and status = 'pending';
  get diagnostics v_sch = row_count;

  return query select v_visits, v_retail, v_other, v_exp, v_sch;
end;
$$;

grant execute on function public.backfill_vat_for_salon(uuid) to authenticated, service_role;

-- Расширяем существующий trigger: при флипе vat_payer → true дёргаем backfill.
-- Категория «Налоги» создавалась раньше; теперь дополнительно бэкфилим VAT.
create or replace function public.salons_vat_payer_to_taxes_cat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_vat boolean;
  new_vat boolean;
begin
  old_vat := (old.accounting_settings->>'vat_payer')::boolean;
  new_vat := (new.accounting_settings->>'vat_payer')::boolean;
  if coalesce(new_vat, false) = true and coalesce(old_vat, false) = false then
    -- 1) Auto-create «Налоги» категорию (старое поведение)
    perform public.ensure_taxes_category_for_salon(new.id);
    -- 2) NEW: backfill VAT за последние 90 дней
    perform public.backfill_vat_for_salon(new.id);
  end if;
  return new;
end;
$$;
