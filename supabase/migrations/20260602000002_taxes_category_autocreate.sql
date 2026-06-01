-- При активации VAT-плательщика — auto-create системная категория «Налоги»
-- в expense_categories, чтобы юзер мог сразу видеть строку «НДС к оплате»
-- в P&L.
--
-- Триггер на UPDATE salons.accounting_settings: если значение vat_payer
-- стало true (раньше было null/false), создаём категорию.

create or replace function public.ensure_taxes_category_for_salon(p_salon_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Идемпотентно: NOT EXISTS guard.
  if not exists (
    select 1 from public.expense_categories
    where salon_id = p_salon_id
      and name = 'Налоги'
      and is_archived = false
  ) then
    insert into public.expense_categories(salon_id, name, is_system, sort_order)
    values (p_salon_id, 'Налоги', true, 990);
  end if;
end;
$$;

grant execute on function public.ensure_taxes_category_for_salon(uuid) to authenticated;

-- Триггер на salons.accounting_settings: при флипе vat_payer→true
-- — создаём категорию.
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
    perform public.ensure_taxes_category_for_salon(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_salons_vat_payer_taxes_cat on public.salons;
create trigger trg_salons_vat_payer_taxes_cat
  after update of accounting_settings on public.salons
  for each row execute function public.salons_vat_payer_to_taxes_cat();

-- Backfill: для всех салонов которые уже плательщики VAT — создаём
-- категорию если её нет.
do $$
declare
  s record;
begin
  for s in
    select id from public.salons
    where (accounting_settings->>'vat_payer')::boolean = true
  loop
    perform public.ensure_taxes_category_for_salon(s.id);
  end loop;
end$$;
