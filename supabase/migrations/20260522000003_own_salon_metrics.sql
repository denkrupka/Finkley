-- =============================================================================
-- 20260522000003_own_salon_metrics.sql
-- =============================================================================
-- Метрики своего салона для Reports → Конкуренты — отдельная таблица,
-- чтобы competitor_snapshots не путать с собственными данными.
--
-- Источники:
--   - scrape Instagram/Facebook public pages (instagram_url, facebook_url
--     из salons) — primary path, работает без OAuth
--   - в будущем: Meta Graph API через messenger_integrations.credentials
--     (требует decrypt и FB Pages scope) — secondary, точнее
--
-- Заполняется тем же cron'ом competitor-sync (07:00 UTC ежедневно).
-- =============================================================================

create table if not exists public.own_salon_metrics (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  kind text not null check (kind in ('rating', 'content', 'occupancy')),
  data jsonb not null default '{}'::jsonb,
  source text not null check (source in ('scrape_instagram', 'scrape_facebook', 'graph_api', 'google', 'booksy', 'manual')),
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- Один snapshot per (salon, kind, source, date) — upsert at-most-once-a-day.
create unique index if not exists ux_own_salon_metrics_dedup
  on public.own_salon_metrics(salon_id, kind, source, snapshot_date);

create index if not exists idx_own_salon_metrics_salon_date
  on public.own_salon_metrics(salon_id, snapshot_date desc);

alter table public.own_salon_metrics enable row level security;

create policy "members read own_salon_metrics"
  on public.own_salon_metrics for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = own_salon_metrics.salon_id and sm.user_id = auth.uid()
    )
  );
