-- =============================================================================
-- 20260521000016_review_request_cron.sql
-- =============================================================================
-- pg_cron: каждые 6 часов триггерим send-review-request edge function.
-- Защита — REVIEW_REQUEST_CRON_SECRET env переменная.
-- =============================================================================

-- pg_cron должен быть включён глобально (расширение supabase).
-- Если нет — этот SQL silent-skip (DO ... NOTHING при отсутствии cron schema).

do $$
declare
  v_url text := current_setting('app.supabase_url', true);
  v_secret text := current_setting('app.review_request_cron_secret', true);
begin
  if v_url is null or v_url = '' then
    raise notice 'app.supabase_url not set, skipping cron schedule for send-review-request';
    return;
  end if;

  -- Удалить старый job если есть.
  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'send_review_request';

  -- Расписание: каждые 6 часов.
  perform cron.schedule(
    'send_review_request',
    '0 */6 * * *',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('content-type', 'application/json'),
        body := jsonb_build_object('token', %L)
      ) as request_id
      $cron$,
      v_url || '/functions/v1/send-review-request',
      coalesce(v_secret, '')
    )
  );
end
$$;
