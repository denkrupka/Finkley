-- Auto-poll для email-channel интеграций (Gmail OAuth + IMAP).
--
-- Архитектура (rendezvous-token, аналогична treatwell-sync-cron):
--   1) pg_cron каждые 2 минуты вызывает cron_run_email_polls()
--   2) Функция выбирает все messenger_integrations с channel='email',
--      status='connected', last_synced_at < now() - 2 min
--   3) Async POST на email-channel с {action:'poll', salon_id}
--   4) Edge function для каждого dёргает Gmail API (если OAuth) или
--      IMAP (если SMTP/IMAP credentials) → upsert messenger_conversations
--      + insert messenger_messages с direction='in'.

create or replace function public.cron_run_email_polls()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration record;
  v_count int := 0;
  v_url text := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/email-channel';
  v_service_key text;
begin
  -- Service key из vault. supabase_functions secrets vault — стандартный
  -- pattern (см. cron-jobs.md). Если vault недоступен — fallback на env.
  begin
    select decrypted_secret into v_service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_service_key := null;
  end;

  for v_integration in
    select id, salon_id
    from public.messenger_integrations
    where channel = 'email'
      and status = 'connected'
      and (last_synced_at is null or last_synced_at < now() - interval '2 minutes')
    limit 50
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(v_service_key, '')
      ),
      body := jsonb_build_object(
        'action', 'poll',
        'salon_id', v_integration.salon_id::text
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cron_run_email_polls() from public;
grant execute on function public.cron_run_email_polls() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'email-auto-poll') then
    perform cron.unschedule('email-auto-poll');
  end if;
end$$;

select cron.schedule(
  'email-auto-poll',
  '*/2 * * * *',
  $$ select public.cron_run_email_polls(); $$
);
