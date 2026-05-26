-- bug 20106e42 — владелец попросил убрать вкладку «Загруженность» из
-- /reports?tab=competitors и удалить связанные данные. UI вкладка удалена
-- в этом же PR (CompetitorsTab.tsx SUB_TABS без 'occupancy').
--
-- Здесь чистим накопленные snapshots:
--   - competitor_snapshots WHERE kind='occupancy'
--   - own_salon_metric_snapshots WHERE kind='occupancy'
-- Сами таблицы и check-constraint не трогаем — это backward-compat и
-- лишний риск миграции. Edge-function competitor-sync продолжает собирать
-- occupancy в фон (мёртвый код), но юзер этого не видит. Cleanup кронов
-- competitor-sync — отдельный спринт.

delete from competitor_snapshots where kind = 'occupancy';

-- own_salon_metric_snapshots может не существовать в старых проектах —
-- через DO для безопасности.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'own_salon_metric_snapshots') then
    delete from own_salon_metric_snapshots where kind = 'occupancy';
  end if;
end $$;
