-- Service planning parameters
-- Параметры для capacity-planning матрицы (как в Excel-таблице owner'а):
-- сколько мастеров, среднее время визита, рабочих часов в день, дней в месяц,
-- реальная загрузка, средний чек, % зарплаты, % расходных материалов.
--
-- Используется в отдельной таблице на странице /services → таб «Параметры».
-- Дефолты подобраны под бьюти-салон.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS staff_count_required smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS avg_service_hours numeric(4, 2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS staff_work_hours_per_day numeric(4, 2) NOT NULL DEFAULT 8.0,
  ADD COLUMN IF NOT EXISTS staff_work_days_per_month smallint NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS utilization_pct numeric(5, 2) NOT NULL DEFAULT 50.0,
  ADD COLUMN IF NOT EXISTS avg_check_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staff_payout_pct numeric(5, 2) NOT NULL DEFAULT 40.0,
  ADD COLUMN IF NOT EXISTS materials_pct numeric(5, 2) NOT NULL DEFAULT 3.0;

COMMENT ON COLUMN services.staff_count_required IS 'Сколько рабочих мест/мастеров одновременно требуется для этой услуги.';
COMMENT ON COLUMN services.avg_service_hours IS 'Среднее время обслуживания клиента, в часах.';
COMMENT ON COLUMN services.staff_work_hours_per_day IS 'Расчётная норма часов работы мастера в день.';
COMMENT ON COLUMN services.staff_work_days_per_month IS 'Расчётная норма рабочих дней мастера в месяц.';
COMMENT ON COLUMN services.utilization_pct IS 'Реальная загрузка мастера в %, 0..100.';
COMMENT ON COLUMN services.avg_check_cents IS 'Средний чек по этой услуге в копейках/центах.';
COMMENT ON COLUMN services.staff_payout_pct IS '% зарплаты мастера от выручки по услуге.';
COMMENT ON COLUMN services.materials_pct IS '% расходных материалов от выручки по услуге.';
