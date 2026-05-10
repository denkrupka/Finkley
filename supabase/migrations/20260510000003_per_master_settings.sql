-- =============================================================================
-- 20260510000003_per_master_settings.sql
-- =============================================================================
-- Индивидуальные настройки на уровне мастера + салона (по запросу владельца):
--
--  * staff.weekly_schedule    — рабочие часы каждого мастера (jsonb)
--  * staff.retail_payout_enabled  — включать retail в payout базу?
--  * staff.retail_payout_percent  — какой % с retail (NULL = тот же что
--    payout_percent для услуг; 0 = retail не оплачивается мастеру)
--  * staff.retention_window_days — индивидуальное окно «возврата клиента»
--    для KPI ретеншна (NULL → fallback к salon.retention_window_days)
--  * salons.retention_window_days  — окно ретеншна для всего салона (default 60)
--  * salons.churn_window_days      — после скольки дней клиент = «ушёл» (default 180)
--
-- + изменение payouts RPC: разделяем service-revenue и retail-revenue,
--   применяем retail_payout_percent если задан.
-- =============================================================================

-- ─── salons-level: окна ретеншна (для RFM-сегментации клиентов) ──────────
alter table public.salons
  add column if not exists retention_window_days int not null default 60
    check (retention_window_days between 7 and 365),
  add column if not exists churn_window_days int not null default 180
    check (churn_window_days between 30 and 730);

comment on column public.salons.retention_window_days is
  'После скольки дней без визита клиент перестаёт считаться «постоянным» (RFM сегмент → lapsed). Default 60 для beauty.';
comment on column public.salons.churn_window_days is
  'После скольки дней клиент считается «ушёл» (churned). Default 180.';

-- ─── staff: weekly_schedule ──────────────────────────────────────────────
-- Формат: {"mon": {"start": "HH:MM", "end": "HH:MM", "off": false}, ...}
-- Default: M-F 09:00-19:00, выходные off.
alter table public.staff
  add column if not exists weekly_schedule jsonb not null default jsonb_build_object(
    'mon', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'tue', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'wed', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'thu', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'fri', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', false),
    'sat', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', true),
    'sun', jsonb_build_object('start', '09:00', 'end', '19:00', 'off', true)
  );

comment on column public.staff.weekly_schedule is
  'Рабочая неделя мастера (jsonb по дням). Используется для расчёта свободных окон (FreeSlotsPanel).';

-- ─── staff: retail payout ────────────────────────────────────────────────
alter table public.staff
  add column if not exists retail_payout_enabled boolean not null default true,
  add column if not exists retail_payout_percent numeric(5,2)
    check (retail_payout_percent is null or (retail_payout_percent >= 0 and retail_payout_percent <= 100));

comment on column public.staff.retail_payout_enabled is
  'Включать retail-продажи мастера в базу payouts? Если false — retail-выручка идёт салону, мастер ничего не получает.';
comment on column public.staff.retail_payout_percent is
  'Отдельный % с retail. NULL = используется payout_percent (тот же что с услуг). 0 = ничего. >0 = override.';

-- ─── staff: retention window (per-master, optional) ──────────────────────
alter table public.staff
  add column if not exists retention_window_days int
    check (retention_window_days is null or retention_window_days between 7 and 365);

comment on column public.staff.retention_window_days is
  'Индивидуальное окно ретеншна для этого мастера (для KPI). NULL = используется salon.retention_window_days.';

-- ─── salon_kb_articles ───────────────────────────────────────────────────
-- Редактируемые статьи базы знаний — по запросу владельца. Сейчас контент
-- захардкожен в KnowledgePage; после этой миграции UI начнёт читать из БД,
-- а на пустой БД — показывать seed из статичной структуры (см. UI слой).
create table if not exists public.salon_kb_articles (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  section text not null check (section in (
    'staff', 'clients', 'finance', 'schedule', 'operations'
  )),
  title text not null,
  body text not null,
  sort_order int not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_salon_kb_articles_salon_section
  on public.salon_kb_articles(salon_id, section, sort_order);

create trigger trg_salon_kb_articles_updated_at
  before update on public.salon_kb_articles
  for each row execute procedure public.set_updated_at();

alter table public.salon_kb_articles enable row level security;

-- Все member'ы салона читают; только owner/admin изменяют.
create policy "kb_select" on public.salon_kb_articles
  for select using (
    salon_id in (select salon_id from public.salon_members where user_id = auth.uid())
  );

create policy "kb_modify_admin" on public.salon_kb_articles
  for all using (
    salon_id in (
      select salon_id from public.salon_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    salon_id in (
      select salon_id from public.salon_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

comment on table public.salon_kb_articles is
  'Редактируемые статьи базы знаний (вместо захардкоженного контента). Видны всем member, редактируются owner/admin.';

-- ─── payouts RPC: учёт retail per-master ─────────────────────────────────
-- Старая версия не различала visits.kind. Теперь:
--   * service_revenue = visits с kind='visit' (или старые без kind)
--   * retail_revenue  = visits с kind='retail'
--   * retail_payout = retail_revenue × (retail_payout_percent или 0 если disabled
--     или payout_percent если enabled но без override)
--   * Итог: service-payout по схеме + retail_payout
drop function if exists public.calculate_payouts_for_period(uuid, date, date);

create or replace function public.calculate_payouts_for_period(
  p_salon_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  staff_id uuid,
  full_name text,
  payout_scheme staff_payout_scheme,
  visit_count bigint,
  revenue_cents bigint,
  payout_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with staff_revenue as (
    select s.id                                          as staff_id,
           s.full_name,
           s.payout_scheme,
           s.payout_percent,
           s.payout_fixed_cents,
           s.chair_rent_cents,
           s.retail_payout_enabled,
           s.retail_payout_percent,
           coalesce(sum(case
             when v.kind = 'retail' then 0
             else v.amount_cents + v.tip_cents - v.discount_cents
           end), 0)::bigint                               as service_revenue_cents,
           coalesce(sum(case
             when v.kind = 'retail' then v.amount_cents + v.tip_cents - v.discount_cents
             else 0
           end), 0)::bigint                               as retail_revenue_cents,
           count(v.id)::bigint                            as visit_count
      from staff s
      left join visits v
        on v.staff_id = s.id
       and v.salon_id = s.salon_id
       and v.status   = 'paid'
       and v.deleted_at is null
       and v.visit_at >= p_period_start::timestamptz
       and v.visit_at <  (p_period_end::date + 1)::timestamptz
     where s.salon_id = p_salon_id
       and s.deleted_at is null
       and s.is_active = true
     group by s.id
  ),
  service_overrides as (
    select v.staff_id,
           coalesce(
             sum(((v.amount_cents + v.tip_cents - v.discount_cents) * o.payout_percent)::bigint / 100),
             0
           )::bigint as override_payout
      from visits v
      join staff_service_overrides o
        on o.staff_id   = v.staff_id
       and o.service_id = v.service_id
      join staff s on s.id = v.staff_id
     where v.salon_id = p_salon_id
       and s.payout_scheme = 'percent_service'
       and v.kind <> 'retail'
       and v.status = 'paid'
       and v.deleted_at is null
       and v.visit_at >= p_period_start::timestamptz
       and v.visit_at <  (p_period_end::date + 1)::timestamptz
     group by v.staff_id
  )
  select sr.staff_id,
         sr.full_name,
         sr.payout_scheme,
         sr.visit_count,
         (sr.service_revenue_cents + sr.retail_revenue_cents)::bigint as revenue_cents,
         (
           -- Service-часть payout по схеме мастера
           (case sr.payout_scheme
              when 'fixed'           then coalesce(sr.payout_fixed_cents, 0)
              when 'percent_revenue' then (sr.service_revenue_cents * coalesce(sr.payout_percent, 0))::bigint / 100
              when 'percent_service' then coalesce(so.override_payout, 0)
              when 'chair_rent'      then -coalesce(sr.chair_rent_cents, 0)
              when 'mixed'           then coalesce(sr.payout_fixed_cents, 0)
                                           + (sr.service_revenue_cents * coalesce(sr.payout_percent, 0))::bigint / 100
            end)::bigint
           +
           -- Retail-часть payout: 0 если выключено, иначе по retail_payout_percent
           -- (или payout_percent если override не задан)
           case
             when not coalesce(sr.retail_payout_enabled, true) then 0
             else (sr.retail_revenue_cents
                   * coalesce(sr.retail_payout_percent, sr.payout_percent, 0))::bigint / 100
           end
         )::bigint as payout_cents
    from staff_revenue sr
    left join service_overrides so on so.staff_id = sr.staff_id
   order by sr.full_name;
$$;

grant execute on function public.calculate_payouts_for_period(uuid, date, date) to authenticated;
