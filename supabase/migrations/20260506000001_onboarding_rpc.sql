-- =============================================================================
-- 20260506000001_onboarding_rpc.sql
-- =============================================================================
-- RPC create_salon_with_setup — атомарное создание салона + owner-membership
-- + staff + service_categories+services + expense_categories.
--
-- Используется из /onboarding (TASK-08). Альтернатива edge-function-у:
-- security definer + проверка auth.uid() даёт ту же гарантию (юзер не может
-- создать салон от чужого имени), но без отдельного Deno deployment.
--
-- Все вставки в одной транзакции — failure на любой стадии откатывает всё.
-- =============================================================================

create or replace function public.create_salon_with_setup(
  p_name text,
  p_country_code text,
  p_currency text,
  p_timezone text,
  p_salon_type text,
  p_locale text default 'ru',
  p_staff jsonb default '[]'::jsonb,
  p_services jsonb default '[]'::jsonb,
  p_expense_categories text[] default array[]::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_salon_id uuid;
  v_staff_item jsonb;
  v_service_item jsonb;
  v_cat_name text;
  v_category_id uuid;
  v_category_map jsonb := '{}'::jsonb;
  v_sort_order int;
begin
  if v_owner_id is null then
    raise exception 'authentication required';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'salon name is required';
  end if;
  if coalesce(trim(p_country_code), '') = '' then
    raise exception 'country_code is required';
  end if;
  if coalesce(trim(p_salon_type), '') = '' then
    raise exception 'salon_type is required';
  end if;

  -- 1. Salon
  insert into public.salons (name, country_code, currency, timezone, salon_type, locale, created_by)
  values (
    trim(p_name),
    upper(trim(p_country_code)),
    coalesce(nullif(trim(p_currency), ''), 'PLN'),
    coalesce(nullif(trim(p_timezone), ''), 'Europe/Warsaw'),
    trim(p_salon_type),
    coalesce(nullif(trim(p_locale), ''), 'ru')
  , v_owner_id)
  returning id into v_salon_id;

  -- 2. Owner membership
  insert into public.salon_members (salon_id, user_id, role)
  values (v_salon_id, v_owner_id, 'owner');

  -- 3. Staff (если переданы)
  for v_staff_item in select * from jsonb_array_elements(p_staff)
  loop
    if coalesce(trim(v_staff_item->>'full_name'), '') = '' then
      continue;
    end if;
    insert into public.staff (
      salon_id, full_name, payout_scheme, payout_percent
    ) values (
      v_salon_id,
      trim(v_staff_item->>'full_name'),
      'percent_revenue',
      greatest(0, least(100, coalesce((v_staff_item->>'payout_percent')::numeric, 40)))
    );
  end loop;

  -- 4. Service categories + services. Категория создаётся on-demand по уникальному имени.
  v_sort_order := 0;
  for v_service_item in select * from jsonb_array_elements(p_services)
  loop
    if coalesce(trim(v_service_item->>'name'), '') = '' then
      continue;
    end if;
    v_cat_name := nullif(trim(v_service_item->>'category_name'), '');
    v_category_id := null;

    if v_cat_name is not null then
      if v_category_map ? v_cat_name then
        v_category_id := (v_category_map->>v_cat_name)::uuid;
      else
        insert into public.service_categories (salon_id, name, sort_order)
        values (v_salon_id, v_cat_name, v_sort_order)
        returning id into v_category_id;
        v_category_map := v_category_map || jsonb_build_object(v_cat_name, v_category_id::text);
        v_sort_order := v_sort_order + 1;
      end if;
    end if;

    insert into public.services (
      salon_id, category_id, name, default_price_cents, default_duration_min
    ) values (
      v_salon_id,
      v_category_id,
      trim(v_service_item->>'name'),
      coalesce((v_service_item->>'default_price_cents')::bigint, 0),
      nullif((v_service_item->>'default_duration_min')::int, 0)
    );
  end loop;

  -- 5. Expense categories
  v_sort_order := 0;
  for v_cat_name in select unnest(p_expense_categories)
  loop
    if coalesce(trim(v_cat_name), '') = '' then
      continue;
    end if;
    insert into public.expense_categories (salon_id, name, is_system, sort_order)
    values (v_salon_id, trim(v_cat_name), true, v_sort_order);
    v_sort_order := v_sort_order + 1;
  end loop;

  return v_salon_id;
end;
$$;

revoke all on function public.create_salon_with_setup(
  text, text, text, text, text, text, jsonb, jsonb, text[]
) from public;

grant execute on function public.create_salon_with_setup(
  text, text, text, text, text, text, jsonb, jsonb, text[]
) to authenticated;
