-- ============================================================================
-- 20260606000001_drop_wfirma_sync.sql
-- Удаляем pull-синхронизацию из wFirma. По решению владельца (06.06): wFirma
-- интеграция превращается в push-only с OCR — расходы добавленные через
-- фото/документ с совпадающим NIP экспортируются В wFirma на OCR, а wFirma
-- сама разносит их по фактурам. Никаких импортов обратно не нужно.
--
-- Что чистим:
--   1) Cron job 'wfirma-auto-sync'
--   2) Function cron_run_wfirma_syncs()
--   3) Table wfirma_sync_triggers (одноразовые токены cron'a)
--
-- ВАЖНО: salon_integrations.last_sync_at / sync_interval_minutes остаются —
-- сохраняем существующие подключения (credentials), просто не дёргаем cron.
-- Импортированные ранее expenses с source='wfirma' тоже остаются как есть.
-- ============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wfirma-auto-sync') then
    perform cron.unschedule('wfirma-auto-sync');
  end if;
end$$;

drop function if exists public.cron_run_wfirma_syncs();
drop table if exists public.wfirma_sync_triggers;
