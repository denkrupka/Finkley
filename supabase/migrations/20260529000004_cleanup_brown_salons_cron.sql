-- ADR-030 — Расписание pg_cron job для cleanup_brown_salons RPC.
-- Идемпотентно: unschedule если существует, потом schedule.

do $$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping schedule';
    return;
  end if;

  -- Удаляем job если уже расписан (на случай если кто-то задал руками).
  for v_job_id in select jobid from cron.job where jobname = 'cleanup-brown-salons'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  -- Расписываем ежедневный запуск в 04:00 UTC.
  perform cron.schedule(
    'cleanup-brown-salons',
    '0 4 * * *',
    $cron$select public.cleanup_brown_salons()$cron$
  );
end$$;
