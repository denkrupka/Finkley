-- =============================================================================
-- 20260521000020_sync_cron.sql
-- =============================================================================
-- pg_cron schedules:
--   - reviews-sync   : каждый день 07:00 UTC (импорт отзывов с Booksy/Google)
--   - competitor-sync: каждый день 08:00 UTC (snapshot цен/рейтинга/контента)
--
-- Защищены rendezvous-токенами (env переменные).
-- =============================================================================

do $$
declare
  v_url text := current_setting('app.supabase_url', true);
  v_secret_reviews text := current_setting('app.reviews_sync_cron_secret', true);
  v_secret_competitor text := current_setting('app.competitor_sync_cron_secret', true);
begin
  if v_url is null or v_url = '' then
    raise notice 'app.supabase_url not set, skipping cron schedules';
    return;
  end if;

  -- reviews-sync
  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'reviews_sync';

  perform cron.schedule(
    'reviews_sync',
    '0 7 * * *',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('content-type', 'application/json'),
        body := jsonb_build_object('token', %L)
      ) as request_id
      $cron$,
      v_url || '/functions/v1/reviews-sync',
      coalesce(v_secret_reviews, '')
    )
  );

  -- competitor-sync
  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'competitor_sync';

  perform cron.schedule(
    'competitor_sync',
    '0 8 * * *',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('content-type', 'application/json'),
        body := jsonb_build_object('token', %L)
      ) as request_id
      $cron$,
      v_url || '/functions/v1/competitor-sync',
      coalesce(v_secret_competitor, '')
    )
  );
end
$$;
