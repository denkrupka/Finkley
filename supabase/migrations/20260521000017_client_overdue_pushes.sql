-- =============================================================================
-- 20260521000017_client_overdue_pushes.sql
-- =============================================================================
-- Anti-spam tracking: какому клиенту мы уже отсылали overdue-push.
-- Один row = один push за определённую category. Через 7 дней можем слать снова.
-- =============================================================================

create table if not exists public.client_overdue_pushes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete cascade,
  days_overdue int not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_client_overdue_pushes_dedup
  on public.client_overdue_pushes(client_id, category_id, sent_at desc);

alter table public.client_overdue_pushes enable row level security;

create policy "members read client_overdue_pushes"
  on public.client_overdue_pushes for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = client_overdue_pushes.salon_id and sm.user_id = auth.uid()
    )
  );

-- =============================================================================
-- pg_cron: каждое утро 09:00 UTC (примерно 11:00-12:00 локально по PL/UA).
-- =============================================================================

do $$
declare
  v_url text := current_setting('app.supabase_url', true);
  v_secret text := current_setting('app.client_overdue_cron_secret', true);
begin
  if v_url is null or v_url = '' then
    raise notice 'app.supabase_url not set, skipping cron schedule for client-overdue-push';
    return;
  end if;

  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'client_overdue_push';

  perform cron.schedule(
    'client_overdue_push',
    '0 9 * * *',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('content-type', 'application/json'),
        body := jsonb_build_object('token', %L)
      ) as request_id
      $cron$,
      v_url || '/functions/v1/client-overdue-push',
      coalesce(v_secret, '')
    )
  );
end
$$;
