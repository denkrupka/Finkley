-- =============================================================================
-- 20260521000015_competitors.sql
-- =============================================================================
-- Мониторинг конкурентов: цены, загруженность, рейтинг, контент.
--
-- Источники:
-- - Booksy: ручной URL, скрейпинг публичных страниц цен и слотов (TODO: edge fn).
-- - Google Maps Places API: рейтинг + кол-во оценок.
-- - Instagram/Facebook Graph: posts count, followers (Meta App Review требуется).
--
-- На первой итерации owner добавляет вручную через Settings UI; данные
-- импортируются через edge functions periodic-cron. UI показывает что есть
-- в БД, без блокировки на наличие реальных скрейперов.
-- =============================================================================

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  /** Source URLs — ручные ссылки от owner'а. Все опциональные. */
  booksy_url text,
  google_place_url text,
  google_place_id text,
  instagram_url text,
  facebook_url text,
  /** is_auto_picked — был ли конкурент добавлен через auto-picker (по геолокации). */
  is_auto_picked boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_competitors_salon on public.competitors(salon_id, is_archived);

alter table public.competitors enable row level security;

create policy "members access competitors"
  on public.competitors for all to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = competitors.salon_id and sm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = competitors.salon_id and sm.user_id = auth.uid()
    )
  );

create trigger trg_competitors_updated_at
  before update on public.competitors
  for each row execute procedure public.set_updated_at();

-- competitor_snapshots: периодический snapshot данных. Один snapshot = один день.
create table if not exists public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  /** Категория snapshot'а: price (цены услуг), occupancy (загруженность),
   *  rating (Google/Booksy ratings), content (соцсети posts/followers). */
  kind text not null check (kind in ('price', 'occupancy', 'rating', 'content')),
  /** Произвольный JSON со снапшотом — структура зависит от kind. */
  data jsonb not null,
  source text not null check (source in ('booksy', 'google', 'instagram', 'facebook', 'manual')),
  /** Дата snapshot'а (для группировки в графиках). */
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_competitor_snapshots_lookup
  on public.competitor_snapshots(competitor_id, kind, snapshot_date desc);

alter table public.competitor_snapshots enable row level security;

create policy "members read competitor_snapshots"
  on public.competitor_snapshots for select to authenticated
  using (
    exists (
      select 1
      from public.competitors c
        join public.salon_members sm
          on sm.salon_id = c.salon_id and sm.user_id = auth.uid()
      where c.id = competitor_snapshots.competitor_id
    )
  );

-- competitor_monitoring_settings — per-salon настройки (какие услуги мониторить).
create table if not exists public.competitor_monitoring_settings (
  salon_id uuid primary key references public.salons(id) on delete cascade,
  /** Список названий услуг для мониторинга цен (точное совпадение с конкурентами
   *  по имени). Если пусто — мониторим Топ-3 услуг салона по выручке. */
  watched_services text[] not null default '{}',
  /** Включён ли auto-picker (по геолокации салона). Дефолт false — ручной выбор. */
  auto_pick_enabled boolean not null default false,
  /** Радиус для auto-pick в метрах. */
  auto_pick_radius_m int not null default 2000,
  updated_at timestamptz not null default now()
);

alter table public.competitor_monitoring_settings enable row level security;

create policy "members access competitor_monitoring_settings"
  on public.competitor_monitoring_settings for all to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = competitor_monitoring_settings.salon_id
        and sm.user_id = auth.uid()
        and sm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = competitor_monitoring_settings.salon_id
        and sm.user_id = auth.uid()
        and sm.role in ('owner', 'admin')
    )
  );

create trigger trg_competitor_monitoring_settings_updated_at
  before update on public.competitor_monitoring_settings
  for each row execute procedure public.set_updated_at();

comment on table public.competitors is
  'Конкуренты салона для мониторинга цен/рейтинга/контента. См. /reports → Конкуренты.';
