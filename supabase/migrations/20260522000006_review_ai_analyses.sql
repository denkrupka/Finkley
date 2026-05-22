-- =============================================================================
-- 20260522000006_review_ai_analyses.sql
-- =============================================================================
-- Кеш AI-анализов отзывов: per-review (single) + агрегатный (bulk).
--
-- scope:
--   single                — анализ конкретного отзыва (review_id NOT NULL)
--   negative_external     — все непрочитанные негативные внешние (Booksy/Google)
--   internal_all          — все внутренние отзывы (форма после визита)
--   internal_unread       — только непрочитанные внутренние
--
-- payload_hash — sha-256 от нормализованного входа (sorted ids, текст, рейтинг).
-- Если набор отзывов изменился — хеш меняется и edge function пересчитывает.
--
-- Используется: edge function reviews-ai-analyze + UI ReviewsTab.
-- =============================================================================

create table if not exists public.review_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  review_id uuid references public.reviews(id) on delete cascade,
  scope text not null check (scope in (
    'single', 'negative_external', 'internal_all', 'internal_unread'
  )),
  payload_hash text not null,
  model text not null,
  locale text not null default 'ru',
  content jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.review_ai_analyses is
  'Кеш AI-разборов отзывов (per-review + bulk). content — структурированный JSON: '
  'situation, root_cause, prevention, psychological_profile, response_strategy и т.п.';

-- Уникальность: по single — на review_id+locale (один свежий анализ на отзыв),
-- по bulk — на (salon_id, scope, payload_hash, locale).
create unique index if not exists ux_review_ai_single
  on public.review_ai_analyses(review_id, locale)
  where scope = 'single';

create unique index if not exists ux_review_ai_bulk
  on public.review_ai_analyses(salon_id, scope, payload_hash, locale)
  where scope <> 'single';

create index if not exists idx_review_ai_salon_created
  on public.review_ai_analyses(salon_id, created_at desc);

alter table public.review_ai_analyses enable row level security;

create policy "members read review_ai_analyses"
  on public.review_ai_analyses for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = review_ai_analyses.salon_id and sm.user_id = auth.uid()
    )
  );

-- Запись — только service-role (через edge function). Никаких insert/update/delete
-- policy для authenticated, поэтому RLS заблокирует прямую запись из SPA.
