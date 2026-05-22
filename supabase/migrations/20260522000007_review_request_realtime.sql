-- =============================================================================
-- 20260522000007_review_request_realtime.sql
-- =============================================================================
-- Меняем расписание send-review-request с «каждые 6 часов» на «каждую минуту».
-- Этого достаточно чтобы клиент получил SMS/Email максимум через минуту после
-- маркировки визита paid — в UI это воспринимается как «сразу после оплаты».
--
-- Edge function send-review-request уже сама фильтрует по anti-dup
-- (review_requests с тем же visit_id не создаются повторно), поэтому
-- учащение cron безопасно.
-- =============================================================================

do $$
declare
  v_url text := current_setting('app.supabase_url', true);
  v_secret text := current_setting('app.review_request_cron_secret', true);
begin
  if v_url is null or v_url = '' then
    raise notice 'app.supabase_url not set, skipping cron rescheduling for send-review-request';
    return;
  end if;

  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'send_review_request';

  perform cron.schedule(
    'send_review_request',
    '* * * * *',  -- каждую минуту
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
