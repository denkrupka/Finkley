-- =============================================================================
-- Системная категория расходов «Комиссии» (T13)
-- =============================================================================
-- При оплате визита/продажи/прочего дохода методом с commission_pct > 0
-- автоматически создаётся расход в этой категории. is_system=true защищает
-- категорию от удаления через UI; в выпадающих списках расходов её скрываем
-- (юзер не должен случайно туда что-то засунуть руками).
--
-- Сеяние по всем существующим салонам + триггер на новые. По уникальности
-- считаем что в каждом салоне нужна одна категория с name='Комиссии'.
-- =============================================================================

-- Сеем по существующим салонам (idempotent).
insert into public.expense_categories (salon_id, name, is_system, sort_order)
select s.id, 'Комиссии', true, 999
  from public.salons s
 where not exists (
   select 1 from public.expense_categories c
    where c.salon_id = s.id
      and c.is_system = true
      and c.name = 'Комиссии'
 );

-- Триггер: при создании нового салона — автоматом сеем категорию «Комиссии».
create or replace function public.tg_seed_commissions_category_for_new_salon()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.expense_categories (salon_id, name, is_system, sort_order)
  values (new.id, 'Комиссии', true, 999)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_commissions_category on public.salons;
create trigger trg_seed_commissions_category
  after insert on public.salons
  for each row execute function public.tg_seed_commissions_category_for_new_salon();

comment on function public.tg_seed_commissions_category_for_new_salon() is
  'T13 — автосеяние системной категории «Комиссии» при создании нового салона. is_system=true защищает от удаления через UI; используется как category_id для авто-расходов от commission_pct payment_methods.';
