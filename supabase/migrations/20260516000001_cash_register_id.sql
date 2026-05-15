-- visits.cash_register_id + expenses.cash_register_id — id из массива
-- financial_settings.cash_registers.items (JSONB на salons). FK не делаем
-- потому что cash_registers — это динамический JSON-список под управлением
-- salon owner'а, а не отдельная таблица.
--
-- По запросу владельца (#51, image #81/#82): в формах визита/продажи/
-- расхода вместо абстрактных «cash/card/transfer/online/mixed» (payment_method)
-- показываем конкретные кассы салона: «Касса директора», «Конверт» и т.д.
-- payment_method остаётся для обратной совместимости + аналитики.

alter table public.visits
  add column if not exists cash_register_id text;
comment on column public.visits.cash_register_id is
  'ID кассы из financial_settings.cash_registers.items[]. Введён в дополнение к payment_method (image #82).';

alter table public.expenses
  add column if not exists cash_register_id text;
comment on column public.expenses.cash_register_id is
  'ID кассы из financial_settings.cash_registers.items[]. Чем оплачено (image #82).';
