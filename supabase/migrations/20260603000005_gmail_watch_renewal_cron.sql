-- Gmail watch renewal cron.
--
-- Gmail Pub/Sub watch валиден 7 дней. После этого Google перестаёт
-- публиковать notifications → push перестаёт работать. Этот cron каждые
-- 6 дней дёргает email-channel action='renew_watch' для всех connected
-- email integrations.
--
-- Без этого юзеру нужно было бы periodically OAuth-нуть заново.

create or replace function public.cron_run_gmail_watch_renewal()
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
  begin
    select decrypted_secret into v_service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_service_key := null;
  end;

  for v_integration in
    select salon_id
    from public.messenger_integrations
    where channel = 'email'
      and status = 'connected'
      and credentials->'oauth'->>'access_token' is not null
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(v_service_key, '')
      ),
      body := jsonb_build_object(
        'action', 'renew_watch',
        'salon_id', v_integration.salon_id::text
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cron_run_gmail_watch_renewal() from public;
grant execute on function public.cron_run_gmail_watch_renewal() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'gmail-watch-renewal') then
    perform cron.unschedule('gmail-watch-renewal');
  end if;
end$$;

-- Каждый 6-й день в 03:00 UTC. Watch валиден 7 дней — успеваем.
select cron.schedule(
  'gmail-watch-renewal',
  '0 3 */6 * *',
  $$ select public.cron_run_gmail_watch_renewal(); $$
);
