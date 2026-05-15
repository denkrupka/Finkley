-- Bug: clients.last_visit_at учитывал будущие забронированные визиты —
-- триггер бил greatest(prev, new.visit_at) при любом INSERT, поэтому
-- запись клиента на «18 мая» переписывала last_visit_at в будущее, и в
-- отчёте Reports → Клиенты строка «Последний визит» уезжала вперёд.
-- Семантика «последний» = «самый поздний из тех, что уже состоялись»;
-- забронированный, но ещё не прошедший визит — это NEXT visit, не LAST.
--
-- Фикс:
--   1. Триггер recalc_client_stats обновляет last_visit_at только когда
--      new.visit_at <= now() И status не cancelled.
--   2. Backfill: пересчитываем last_visit_at у всех клиентов из visits
--      по правилу «max(visit_at) WHERE visit_at <= now() AND not cancelled».
--
-- visit_count и total_revenue_cents трогать НЕ нужно: они и так считаются
-- по всем визитам (включая будущие), это отдельная семантика «общая
-- история отношений», нормально что считаем по всему.

create or replace function public.recalc_client_stats()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.client_id is not null) then
    update clients set
      visit_count = visit_count + 1,
      total_revenue_cents = total_revenue_cents + new.amount_cents,
      last_visit_at = case
        when new.visit_at <= now() and coalesce(new.status, 'paid') <> 'cancelled'
          then greatest(coalesce(last_visit_at, '1970-01-01'::timestamptz), new.visit_at)
        else last_visit_at
      end
    where id = new.client_id;
  elsif (tg_op = 'DELETE' and old.client_id is not null) then
    update clients set
      visit_count = greatest(0, visit_count - 1),
      total_revenue_cents = greatest(0, total_revenue_cents - old.amount_cents)
    where id = old.client_id;
  end if;
  return null;
end;
$$ language plpgsql;

-- Backfill: проставляем актуальный last_visit_at у тех клиентов, у кого
-- есть хотя бы один past-визит (не отменённый, не удалённый).
update clients c
set last_visit_at = sub.last_at
from (
  select client_id, max(visit_at) as last_at
  from visits
  where client_id is not null
    and visit_at <= now()
    and coalesce(status, 'paid') <> 'cancelled'
    and deleted_at is null
  group by client_id
) sub
where c.id = sub.client_id;

-- У кого past-визитов больше нет (только будущие или только отменённые)
-- — last_visit_at сбрасываем в NULL.
update clients c
set last_visit_at = null
where last_visit_at is not null
  and not exists (
    select 1 from visits v
    where v.client_id = c.id
      and v.visit_at <= now()
      and coalesce(v.status, 'paid') <> 'cancelled'
      and v.deleted_at is null
  );
