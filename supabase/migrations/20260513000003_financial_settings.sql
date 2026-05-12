-- Financial settings (вводные параметры салона)
-- Кассы (стартовые остатки), постоянные расходы, переменные %, налоги,
-- инвестиции, движение денег от собственника. Эти значения вводит owner,
-- они используются в финансовых расчётах: cash-flow forecast, PnL,
-- break-even, ROI.
--
-- Структура — jsonb на salons, чтобы можно было добавлять/убирать поля
-- без миграций. Дефолты — все нули.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS financial_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN salons.financial_settings IS
  'Owner-configured financial inputs: cash registers, fixed/variable expenses, taxes, investments, money flows. См. types/FinancialSettings.';
