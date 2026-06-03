-- =============================================================================
-- Системная категория «БЕЗ КАТЕГОРИИ» для импортированных расходов.
-- =============================================================================
-- Когда KSeF/wFirma/прочие импорты приносят фактуру без точного маппинга
-- на категорию, ksef-proxy раньше оставлял `expenses.category_id = NULL`.
-- Из-за этого в pie-chart структуры расходов и в P&L такие траты
-- пропускались (`if (!e.category_id) continue`) и владелец видел
-- неполную картину расходов.
--
-- Эта системная категория — placeholder, в который автоматически
-- попадают импортированные расходы без точного маппинга. В UI скрыта
-- из выпашек категорий (как «Комиссии»), чтобы юзер не выбирал её
-- руками — она появляется только из импортов.
--
-- Имя — литерал «БЕЗ КАТЕГОРИИ» по запросу владельца.
-- =============================================================================

-- Сеем по существующим салонам (idempotent).
insert into public.expense_categories (salon_id, name, is_system, sort_order)
select s.id, 'БЕЗ КАТЕГОРИИ', true, 998
  from public.salons s
 where not exists (
   select 1 from public.expense_categories c
    where c.salon_id = s.id
      and c.is_system = true
      and c.name = 'БЕЗ КАТЕГОРИИ'
 );

-- Триггер: при создании нового салона автоматом сеем эту категорию.
create or replace function public.tg_seed_uncategorized_for_new_salon()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.expense_categories (salon_id, name, is_system, sort_order)
  values (new.id, 'БЕЗ КАТЕГОРИИ', true, 998)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_uncategorized_category on public.salons;
create trigger trg_seed_uncategorized_category
  after insert on public.salons
  for each row execute function public.tg_seed_uncategorized_for_new_salon();

comment on function public.tg_seed_uncategorized_for_new_salon() is
  'Автосеяние системной категории «БЕЗ КАТЕГОРИИ» при создании нового салона. Сюда падают импортированные расходы (KSeF/wFirma/...) у которых нет точного маппинга на категорию. is_system=true защищает от удаления; в UI скрыта из выпадашек выбора (как «Комиссии»).';

-- Backfill: все expenses с source='ksef' и category_id IS NULL уезжают в
-- эту категорию салона. Делаем одним UPDATE через JOIN.
update public.expenses e
   set category_id = c.id
  from public.expense_categories c
 where c.salon_id = e.salon_id
   and c.is_system = true
   and c.name = 'БЕЗ КАТЕГОРИИ'
   and e.category_id is null
   and e.source = 'ksef'
   and e.deleted_at is null;

-- Аналогично для scheduled_payments (неоплаченных KSeF-фактур).
update public.scheduled_payments sp
   set category_id = c.id
  from public.expense_categories c
 where c.salon_id = sp.salon_id
   and c.is_system = true
   and c.name = 'БЕЗ КАТЕГОРИИ'
   and sp.category_id is null
   and sp.source = 'ksef';
