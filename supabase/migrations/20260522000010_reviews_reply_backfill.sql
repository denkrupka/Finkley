-- =============================================================================
-- 20260522000010_reviews_reply_backfill.sql
-- =============================================================================
-- Backfill: до миграции _reviews_reply.sql функция reviews-sync склеивала ответ
-- салона в body как "\n\n— Ответ салона: <text>". После выделения reply_text/
-- reply_author/reply_posted_at в отдельные колонки cron сам апдейтит только
-- новые reviews; старые остались со склейкой в body.
--
-- Этот скрипт разбирает «склеенные» body, перекладывает reply в reply_text
-- (если reply_text ещё null) и оставляет в body чистый текст отзыва.
--
-- Идемпотентно — повторный прогон ничего не сломает, бо condition по '— Ответ салона:'.
-- =============================================================================

update public.reviews
   set
     reply_text = coalesce(
       reply_text,
       trim(substring(body from position(E'\n\n— Ответ салона: ' in body) + length(E'\n\n— Ответ салона: ')))
     ),
     reply_author = coalesce(reply_author, 'Booksy'),
     body = trim(substring(body from 1 for position(E'\n\n— Ответ салона: ' in body) - 1))
 where body like E'%\n\n— Ответ салона: %';
