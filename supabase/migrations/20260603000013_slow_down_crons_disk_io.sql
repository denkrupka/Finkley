-- Supabase 02.06 алёрт: проект истощает Disk IO Budget. Аудит cron-ов
-- показал агрессивные расписания, замедляем 5 основных:
--   review_request_realtime    * * * * *    →  */5 * * * *
--   booksy_sync                */2 * * * *  →  */10 * * * *
--   ksef_sync                  */2 / */15   →  */15 * * * *
--   email_poll                 */2 * * * *  →  */5 * * * *
--   treatwell_sync             */5 * * * *  →  */15 * * * *
-- + tracking_events TTL: delete > 90 days daily
--
-- Паттерн: select cron.unschedule(jobname) from cron.job where jobname=...;
-- → no-op если job не существует. Затем cron.schedule с новым cron-выражением.
-- Если функция-обработчик отсутствует (например на staging) — schedule
-- пропускается через case-when чтобы не падать. cron.schedule возвращает
-- bigint, null::bigint выбран как ветка else.

-- review_request_realtime → */5
select cron.unschedule(jobname) from cron.job where jobname in (
  'review-request-realtime', 'review_request_realtime',
  'review-request-cron', 'review_request_cron'
);

select case
  when exists (select 1 from pg_proc where proname = 'cron_send_review_requests')
  then cron.schedule(
    'review-request-cron',
    '*/5 * * * *',
    'select public.cron_send_review_requests();'
  )
  else null::bigint
end;

-- Booksy: */2 → */10
select cron.unschedule(jobname) from cron.job where jobname = 'booksy-auto-sync';
select case
  when exists (select 1 from pg_proc where proname = 'cron_run_booksy_syncs')
  then cron.schedule(
    'booksy-auto-sync',
    '*/10 * * * *',
    'select public.cron_run_booksy_syncs();'
  )
  else null::bigint
end;

-- KSeF: unify to */15
select cron.unschedule(jobname) from cron.job where jobname = 'ksef-auto-sync';
select case
  when exists (select 1 from pg_proc where proname = 'cron_run_ksef_syncs')
  then cron.schedule(
    'ksef-auto-sync',
    '*/15 * * * *',
    'select public.cron_run_ksef_syncs();'
  )
  else null::bigint
end;

-- Email-poll: */2 → */5 (Gmail Pub/Sub покрывает realtime)
select cron.unschedule(jobname) from cron.job where jobname in (
  'email-poll', 'email_poll', 'email-channel-poll'
);
select cron.schedule(
  'email-poll',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/email-channel',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('action', 'poll_all')
    );
  $$
);

-- Treatwell: */5 → */15
select cron.unschedule(jobname) from cron.job where jobname = 'treatwell-auto-sync';
select case
  when exists (select 1 from pg_proc where proname = 'cron_run_treatwell_syncs')
  then cron.schedule(
    'treatwell-auto-sync',
    '*/15 * * * *',
    'select public.cron_run_treatwell_syncs();'
  )
  else null::bigint
end;

-- TTL для tracking_events — удаляем события старше 90 дней раз в день
-- (защита от безграничного роста таблицы → роста index size → роста Disk IO)
select cron.unschedule(jobname) from cron.job where jobname = 'tracking-events-ttl';
select cron.schedule(
  'tracking-events-ttl',
  '0 4 * * *',
  $$ delete from public.tracking_events where created_at < now() - interval '90 days'; $$
);
