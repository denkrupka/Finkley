-- =============================================================================
-- 20260510000012_dedup_ksef_id_backfill.sql
-- =============================================================================
-- TASK-51: source-of-truth dedup по metadata->>'ksef_id'.
--
-- В TASK-46 был создан unique index idx_expenses_salon_ksef_id на
-- (salon_id, metadata->>'ksef_id'). До этой миграции wfirma-proxy писал
-- KSeF-номер в metadata.wfirma_ksef_id — переносим его в стандартное
-- metadata.ksef_id, чтобы дедуп с КСеФ direct заработал.
--
-- Если у юзера уже были КСеФ-расходы — их у нас нет (KSeF integration новая),
-- поэтому коллизий быть не может. На случай редкого прецедента дубля —
-- используем DISTINCT ON чтобы оставить первую запись.
-- =============================================================================

-- Шаг 1: дроп индекс на время backfill (быстрее update)
drop index if exists public.idx_expenses_salon_ksef_id;

-- Шаг 2: backfill metadata.ksef_id из metadata.wfirma_ksef_id для wFirma-расходов
update public.expenses
set metadata = metadata || jsonb_build_object('ksef_id', metadata->>'wfirma_ksef_id')
where source = 'wfirma'
  and metadata ? 'wfirma_ksef_id'
  and (metadata->>'wfirma_ksef_id') is not null
  and (metadata->>'wfirma_ksef_id') <> ''
  and (
    not (metadata ? 'ksef_id')
    or (metadata->>'ksef_id') is null
    or (metadata->>'ksef_id') = ''
  );

-- Шаг 3: на случай редкого дубля (одна и та же фактура импортирована из wFirma
-- дважды или из wFirma + КСеФ через legacy путь) — soft-delete все кроме первой.
-- Применяем только если коллизия реально найдена.
do $$
declare
  v_dup record;
begin
  for v_dup in
    select salon_id, metadata->>'ksef_id' as ksef_id, count(*)
    from public.expenses
    where metadata->>'ksef_id' is not null and deleted_at is null
    group by salon_id, metadata->>'ksef_id'
    having count(*) > 1
  loop
    -- Оставляем самую раннюю (по created_at) запись, остальные soft-delete'им
    update public.expenses
    set deleted_at = now(),
        metadata = metadata || jsonb_build_object(
          'dedup_reason', 'duplicate_ksef_id_backfill_20260510'
        )
    where salon_id = v_dup.salon_id
      and metadata->>'ksef_id' = v_dup.ksef_id
      and deleted_at is null
      and id <> (
        select id from public.expenses
        where salon_id = v_dup.salon_id
          and metadata->>'ksef_id' = v_dup.ksef_id
          and deleted_at is null
        order by created_at asc
        limit 1
      );
  end loop;
end$$;

-- Шаг 4: пересоздаём unique index
create unique index idx_expenses_salon_ksef_id
  on public.expenses (salon_id, (metadata->>'ksef_id'))
  where metadata->>'ksef_id' is not null and deleted_at is null;

comment on index public.idx_expenses_salon_ksef_id is
  'Source-of-truth dedup по NumerKSeF (см. ADR-013 §D). UNIQUE_VIOLATION '
  'при insert означает что фактуру уже импортировали из другого портала — '
  'sync-логика провайдера ловит код 23505 и скипает.';
