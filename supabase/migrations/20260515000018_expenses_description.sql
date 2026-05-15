-- expenses.description — обязательное поле «Описание расхода».
-- Раньше эту функцию выполнял comment (опциональный), теперь по запросу
-- владельца (image #94) Описание делается обязательным и отдельным полем
-- над категорией. Комментарий остаётся опциональным.
--
-- Default '' даёт безопасную миграцию для старых строк; новые расходы
-- получают строку из UI, а старые «допишутся» через backfill из comment
-- если он есть.

alter table public.expenses
  add column if not exists description text not null default '';

comment on column public.expenses.description is
  'Обязательное короткое описание расхода (например, "Краска Wella", "Аренда май"). Раньше эту функцию выполнял comment.';

-- Backfill для существующих строк: если в comment есть текст — берём
-- первые 200 символов как description, чтобы старые записи остались
-- читаемыми в списке расходов.
update public.expenses
set description = left(coalesce(comment, ''), 200)
where description = '' and comment is not null and comment <> '';
