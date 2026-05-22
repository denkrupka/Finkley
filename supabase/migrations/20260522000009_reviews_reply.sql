-- =============================================================================
-- 20260522000009_reviews_reply.sql
-- =============================================================================
-- Денормализованный ответ салона на отзыв. У Booksy/Google платформа разрешает
-- ровно 1 reply от business per review — поэтому self-FK таблица избыточна,
-- кладём поля прямо в reviews.
--
-- До этой миграции reviews-sync склеивал reply в body как "\n\n— Ответ салона: ...".
-- После — храним отдельно + UI показывает дерево «Ответы» под отзывом.
-- =============================================================================

alter table public.reviews
  add column if not exists reply_text text,
  add column if not exists reply_author text,
  add column if not exists reply_posted_at timestamptz;

comment on column public.reviews.reply_text is
  'Ответ салона на отзыв (1 reply per review — таково правило Booksy/Google).';
comment on column public.reviews.reply_author is
  'Имя автора ответа (обычно «Salon Owner» или название салона).';
comment on column public.reviews.reply_posted_at is
  'Дата ответа салона.';
