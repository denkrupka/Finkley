-- Manual content overrides для Instagram / Facebook метрик.
--
-- Авто-scraping Meta-страниц не работает с Supabase Edge IP (Instagram отдаёт
-- SPA-shell без og:description, Facebook — login-wall). Без платного proxy
-- единственный путь к корректным цифрам — ручной ввод владельцем салона
-- (для своего салона и для каждого конкурента).
--
-- Поля nullable: NULL = «не введено вручную», UI должен показать fallback на
-- последний удачный auto-scrape snapshot или «—».

alter table public.salons
  add column if not exists content_followers integer,
  add column if not exists content_posts integer,
  add column if not exists content_fb_likes integer,
  add column if not exists content_posts_per_month numeric(6, 1),
  add column if not exists content_updated_at timestamptz;

alter table public.competitors
  add column if not exists content_followers integer,
  add column if not exists content_posts integer,
  add column if not exists content_fb_likes integer,
  add column if not exists content_posts_per_month numeric(6, 1),
  add column if not exists content_updated_at timestamptz;

comment on column public.salons.content_followers is 'Manual override: число подписчиков в Instagram. NULL = брать скраппинг.';
comment on column public.salons.content_posts is 'Manual override: число постов в Instagram. NULL = брать скраппинг.';
comment on column public.salons.content_fb_likes is 'Manual override: лайки на FB-странице. NULL = брать скраппинг.';
comment on column public.salons.content_posts_per_month is 'Manual override: средняя частота постов в месяц.';
comment on column public.competitors.content_followers is 'Manual override: число подписчиков в Instagram конкурента.';
comment on column public.competitors.content_posts is 'Manual override: число постов в Instagram конкурента.';
comment on column public.competitors.content_fb_likes is 'Manual override: лайки на FB-странице конкурента.';
comment on column public.competitors.content_posts_per_month is 'Manual override: средняя частота постов в месяц.';
