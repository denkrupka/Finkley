-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000008_backfill_categories_from_financial_settings.sql
--
-- Миграция данных: переносим items из salons.financial_settings.fixed и
-- .variable в expense_categories. Раньше Бюджеты читали из jsonb-секций,
-- теперь читают из таблицы. Без backfill'а у существующих салонов в новых
-- Бюджетах был бы пустой список.
--
-- Стратегия:
--   - Идём по каждому салону
--   - Для каждого item из financial_settings.fixed.items (не archived):
--     если в expense_categories ещё нет строки с таким (salon_id, name) —
--     создаём её с kind='fixed', monthly_budget_cents = item.amount_cents.
--   - То же для variable, но kind='variable', monthly_budget_pct = item.pct.
--   - Дубли по имени игнорируем (юзер уже мог создать такую категорию
--     вручную — оставляем её без изменений).
--
-- Идемпотентность: миграция безопасна для повторного выполнения, потому
-- что NOT EXISTS-чек предотвращает дубли.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  salon_rec record;
  item jsonb;
  item_label text;
  item_amount bigint;
  item_pct numeric;
begin
  for salon_rec in select id, financial_settings from salons loop
    -- FIXED items → kind='fixed', monthly_budget_cents
    for item in
      select value
      from jsonb_array_elements(
        coalesce(salon_rec.financial_settings->'fixed'->'items', '[]'::jsonb)
      )
    loop
      -- archived items пропускаем
      if (item->>'archived')::boolean is true then
        continue;
      end if;

      item_label := trim(both from coalesce(item->>'label', ''));
      if item_label = '' then continue; end if;

      item_amount := nullif(item->>'amount_cents', '')::bigint;

      if not exists (
        select 1 from expense_categories
        where salon_id = salon_rec.id
          and lower(name) = lower(item_label)
      ) then
        insert into expense_categories
          (salon_id, name, kind, monthly_budget_cents, sort_order)
        values
          (salon_rec.id, item_label, 'fixed', item_amount, 100);
      end if;
    end loop;

    -- VARIABLE items → kind='variable', monthly_budget_pct
    for item in
      select value
      from jsonb_array_elements(
        coalesce(salon_rec.financial_settings->'variable'->'items', '[]'::jsonb)
      )
    loop
      if (item->>'archived')::boolean is true then
        continue;
      end if;

      item_label := trim(both from coalesce(item->>'label', ''));
      if item_label = '' then continue; end if;

      item_pct := nullif(item->>'pct', '')::numeric;

      if not exists (
        select 1 from expense_categories
        where salon_id = salon_rec.id
          and lower(name) = lower(item_label)
      ) then
        insert into expense_categories
          (salon_id, name, kind, monthly_budget_pct, sort_order)
        values
          (salon_rec.id, item_label, 'variable', item_pct, 100);
      end if;
    end loop;
  end loop;
end
$$;
