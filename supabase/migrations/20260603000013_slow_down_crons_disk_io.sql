-- Supabase 02.06 алёрт: проект истощает Disk IO Budget.
--
-- Аудит cron-ов показал агрессивные расписания:
--   review_request_realtime    * * * * *       (1440/день)
--   booksy_sync                */2 * * * *     (720/день)
--   ksef_sync (новый, мой)     */2 * * * *     (720/день)  — дубликат старого
--   email_poll                 */2 * * * *     (720/день)
--   treatwell_sync             */5 * * * *     (288/день)
--   ksef_sync (старый)         */15 * * * *    (96/день)
--
-- Большинство этих интеграций возвращают новые данные раз в N минут максимум,
-- такая частота избыточна. Снижаем нагрузку на 3-5x. Бизнес-логика не страдает
-- (юзер не заметит что Booksy подтянулся через 10 минут вместо 2).
--
-- Замедляем (replace = unschedule + schedule):
--   review_request_realtime    * * * * *    →  */5 * * * *   (-80%)
--   booksy_sync                */2 * * * *  →  */10 * * * *  (-80%)
--   ksef_sync (объединено)     */2/*/15     →  */15 * * * *  (-86%)
--   email_poll                 */2 * * * *  →  */5 * * * *   (-60%)
--   treatwell_sync             */5 * * * *  →  */15 * * * *  (-66%)

do $$
declare
  rec record;
begin
  -- review_request_realtime
  for rec in select jobid, jobname from cron.job where jobname in (
    'review-request-realtime',
    'review_request_realtime'
  ) loop
    perform cron.unschedule(rec.jobname);
  end loop;
end$$;

do $$
declare
  v_jobid bigint;
begin
  -- Поищем по command, jobname может разный быть.
  for v_jobid in
    select jobid from cron.job
    where command ilike '%review_request%' or jobname ilike '%review_request%'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end$$;

-- Booksy: */2 → */10
do $$
begin
  if exists (select 1 from cron.job where jobname = 'booksy-auto-sync') then
    perform cron.unschedule('booksy-auto-sync');
  end if;
end$$;

select cron.schedule(
  'booksy-auto-sync',
  '*/10 * * * *',
  $$ select public.cron_run_booksy_syncs(); $$
);

-- KSeF: оставляем 1 cron, */15. У меня в _10 был */2 — он перезаписал старый.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ksef-auto-sync') then
    perform cron.unschedule('ksef-auto-sync');
  end if;
end$$;

select cron.schedule(
  'ksef-auto-sync',
  '*/15 * * * *',
  $$ select public.cron_run_ksef_syncs(); $$
);

-- Email-poll: */2 → */5 (Gmail Pub/Sub push заменит cron в большинстве случаев).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'email-poll') then
    perform cron.unschedule('email-poll');
  end if;
  if exists (select 1 from cron.job where jobname = 'email_poll') then
    perform cron.unschedule('email_poll');
  end if;
end$$;

-- Найдём по command если jobname нестандартный
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job
    where command ilike '%email-channel%' and command ilike '%poll%'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end$$;

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
do $$
begin
  if exists (select 1 from cron.job where jobname = 'treatwell-auto-sync') then
    perform cron.unschedule('treatwell-auto-sync');
  end if;
end$$;

-- Только если функция существует — иначе schedule провалится в migrate
do $$
begin
  if exists (select 1 from pg_proc where proname = 'cron_run_treatwell_syncs') then
    perform cron.schedule(
      'treatwell-auto-sync',
      '*/15 * * * *',
      $$ select public.cron_run_treatwell_syncs(); $$
    );
  end if;
end$$;

-- Review request — replace c */5 (если функция есть)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'cron_send_review_requests') then
    perform cron.schedule(
      'review-request-cron',
      '*/5 * * * *',
      $$ select public.cron_send_review_requests(); $$
    );
  end if;
end$$;

-- TTL для tracking_events — удаляем события старше 90 дней раз в день
-- (защита от безграничного роста таблицы → роста index size → роста Disk IO).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'tracking-events-ttl') then
    perform cron.unschedule('tracking-events-ttl');
  end if;
end$$;

select cron.schedule(
  'tracking-events-ttl',
  '0 4 * * *',  -- 04:00 UTC daily
  $$ delete from public.tracking_events where created_at < now() - interval '90 days'; $$
);
