-- Daily digest flag on salons
-- Boolean per-salon: включена ли ежедневная сводка на email владельца.
-- По умолчанию выключено — owner сам активирует в Настройках.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN salons.daily_digest_enabled IS
  'Активирована ли ежедневная сводка (send-daily-digest edge function).';
