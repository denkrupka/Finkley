-- =============================================================================
-- 20260510000001_audit_log_payload_column.sql
-- =============================================================================
-- Фикс рассинхрона: 20260505000006 создаёт audit_log с колонкой `diff`,
-- а триггеры из 20260508000007 пишут в `payload`. На fresh DB триггер
-- IF NOT EXISTS create-table создаст с `payload` сразу. На staging/prod,
-- куда сначала пришла init-миграция, существует только `diff`, и любой
-- INSERT на visits/expenses/salon_members ломается с
-- `column "payload" of relation "audit_log" does not exist`.
--
-- Чиним: переименовываем `diff` → `payload` (если есть `diff` и нет `payload`);
-- если уже `payload` — no-op.
-- =============================================================================

do $$
declare
  has_diff boolean;
  has_payload boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_log' and column_name = 'diff'
  ) into has_diff;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_log' and column_name = 'payload'
  ) into has_payload;

  if has_diff and not has_payload then
    alter table public.audit_log rename column diff to payload;
  elsif not has_payload then
    -- Совсем нет колонки — добавим. Может случиться если кто-то дропал руками.
    alter table public.audit_log add column payload jsonb;
  end if;
end$$;

-- Также фиксим entity_id: триггеры из 20260508000007 кастуют new.id::text
-- (потому что разные таблицы могут иметь разные типы id), а колонка
-- определена как uuid в init-миграции. На fresh DB триггер пересоздаёт
-- таблицу и тип может отличаться. Унифицируем на text.
do $$
declare
  v_type text;
begin
  select data_type into v_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'audit_log' and column_name = 'entity_id';
  if v_type = 'uuid' then
    alter table public.audit_log alter column entity_id type text using entity_id::text;
  end if;
end$$;
