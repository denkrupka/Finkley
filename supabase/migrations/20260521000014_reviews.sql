-- =============================================================================
-- 20260521000014_reviews.sql
-- =============================================================================
-- Сбор отзывов после визита: FlySMS-style flow.
-- 1. После завершения визита (status=paid) клиенту шлётся email/SMS с короткой
--    ссылкой /review/<token>.
-- 2. Клиент открывает страницу, выбирает 1-5 звёзд.
-- 3. Если 5 ⭐ → редирект на google_place_url (oставить публичный отзыв).
--    Если 1-4 ⭐ → форма «оставить отзыв» (внутренний review, не публичный).
--
-- Таблицы:
--   - review_requests   — токены и метаданные приглашения на отзыв
--   - reviews           — записи отзывов (внутренние + импорт с Booksy/Google)
--
-- Конфиг салона: salons.google_place_url для редиректа высоких оценок.
-- =============================================================================

alter table public.salons
  add column if not exists google_place_url text;

comment on column public.salons.google_place_url is
  'Ссылка на Google Maps место салона. Используется для редиректа 5★ отзывов из FlySMS-flow.';

-- review_requests: один токен на визит. Создаётся в edge function после paid.
create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  token text not null unique,
  expires_at timestamptz not null default (now() + interval '30 days'),
  opened_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_review_requests_salon on public.review_requests(salon_id, created_at desc);
create index if not exists idx_review_requests_token on public.review_requests(token);

alter table public.review_requests enable row level security;

-- Members of salon видят свои request'ы. Никаких public RLS — токен в URL = auth.
create policy "members read review_requests"
  on public.review_requests for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = review_requests.salon_id and sm.user_id = auth.uid()
    )
  );

-- reviews: внутренние отзывы (через FlySMS-flow) + импорт с Booksy/Google.
create type public.review_source as enum ('internal', 'booksy', 'google');
create type public.review_visibility as enum ('private', 'public');

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  source public.review_source not null default 'internal',
  visibility public.review_visibility not null default 'private',
  /** 1-5 звёзд. null допустим для импорта без рейтинга. */
  rating int check (rating is null or (rating between 1 and 5)),
  body text,
  author_name text,
  client_id uuid references public.clients(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  visit_id uuid references public.visits(id) on delete set null,
  /** Внешний id для anti-duplicate при импорте из Booksy/Google. */
  external_id text,
  external_url text,
  /** Отзыв прочитан админом (для негативных — выбрасывает из «новые»). */
  read_at timestamptz,
  /** Когда оставлен. У внутренних — submitted_at, у импорта — оригинальная дата. */
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists ux_reviews_external
  on public.reviews(salon_id, source, external_id)
  where external_id is not null;

create index if not exists idx_reviews_salon_posted on public.reviews(salon_id, posted_at desc);
create index if not exists idx_reviews_salon_visibility on public.reviews(salon_id, visibility, posted_at desc);

alter table public.reviews enable row level security;

create policy "members read reviews"
  on public.reviews for select to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = reviews.salon_id and sm.user_id = auth.uid()
    )
  );

create policy "owners admins update reviews"
  on public.reviews for update to authenticated
  using (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = reviews.salon_id
        and sm.user_id = auth.uid()
        and sm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.salon_members sm
      where sm.salon_id = reviews.salon_id
        and sm.user_id = auth.uid()
        and sm.role in ('owner', 'admin')
    )
  );

comment on table public.reviews is
  'Отзывы клиентов: внутренние (через /review/:token) + импорт с Booksy/Google. См. /reports → отзывы.';
