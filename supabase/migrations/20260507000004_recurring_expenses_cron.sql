-- =============================================================================
-- 20260507000004_recurring_expenses_cron.sql
-- =============================================================================
-- Регистрирует ежедневный cron на 03:00 UTC для process-recurring-expenses.
-- Функция идемпотентна — повторный запуск в один день безопасен (next_occurrence_at
-- уже сдвинут вперёд).
--
-- ⚠️ Перед тем как cron начнёт реально работать, секрет нужно один раз положить
-- в Supabase Vault через SQL Editor:
--
--   select vault.create_secret(
--     '<значение FUNCTION_INTERNAL_SECRET из Dashboard → Edge Functions → Secrets>',
--     'function_internal_secret'
--   );
--
-- До тех пор cron будет запускаться по расписанию, но edge-function вернёт
-- 401 unauthorized — никаких side-effects, безопасно.
-- =============================================================================

-- pg_net нужен для исходящих HTTP из cron-job
create extension if not exists pg_net with schema extensions;

-- Идемпотентная миграция: снести предыдущую регистрацию если есть
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-recurring-expenses') then
    perform cron.unschedule('process-recurring-expenses');
  end if;
end$$;

-- 03:00 UTC ежедневно (≈ 04:00 Warsaw зимой / 05:00 летом)
select cron.schedule(
  'process-recurring-expenses',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/process-recurring-expenses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Finkley-Secret', coalesce(
        (select decrypted_secret
           from vault.decrypted_secrets
          where name = 'function_internal_secret'
          limit 1),
        ''
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
