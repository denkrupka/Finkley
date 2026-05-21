-- Booksy импорт: услуги приходят сгруппированные в `service_categories`,
-- но мы их раньше импортировали без category_id. На скриншоте 28 услуг лежат
-- "Без категории" с суммой 13 173,63 PLN. Чтобы маппить категорию из Booksy
-- к локальной service_categories — нужны external_source/external_id колонки
-- (по аналогии со staff/services/clients).

alter table public.service_categories
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists external_snapshot jsonb;

create unique index if not exists ux_service_categories_external
  on public.service_categories(salon_id, external_source, external_id)
  where external_id is not null;
