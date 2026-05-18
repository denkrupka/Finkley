# ADR-016: Lazy media для Telegram userbot — скачивание только при открытом чате + TTL 5 минут

## Статус

`Accepted`

Дата: 2026-05-19

## Контекст

После запуска tg-userbot (ADR-015) worker по умолчанию качал каждое медиа из
входящих TG-сообщений в Supabase Storage (`tg-media`). Один активный
пользователь с 50 диалогами и средней активностью генерирует за неделю
~500-1000 МБ медиа, при этом 95% этих файлов никогда не просматриваются
в портале (юзер уже видел сообщение в самом Telegram-клиенте). Это:

- Забивает 1 GB free-tier Supabase Storage за пару недель.
- Кушает 30 GB диск VM (когда tmpfs-кэш Telethon тоже что-то держит).
- Расходует egress-трафик из TG → VM → Supabase зря.

Владелец явно сформулировал требование: «скачивать только то что видно в
открытом чате, через 5 минут после ухода — удалять».

## Решение

**Lazy media с trекингом открытия чата:**

1. **Worker НЕ качает медиа в `_persist_message`.** Сообщение пишется в
   `tg_messages` с заполненным `media_kind`, но `media_path = null`.

2. **Таблица `tg_dialog_views(session_id, dialog_id, last_opened_at,
last_closed_at)`** — трекинг жизненного цикла открытого диалога.

3. **SPA при открытии чата** (`useTgDialogOpen` hook):
   - upsert'ит `last_opened_at = now()`, heartbeat-обновление каждые 60 сек
   - для каждого `tg_message` где `media_kind != null && media_path == null`
     инсертит в `tg_outbox` action `download_media` с `tg_message_id`
   - при unmount — upsert `last_closed_at = now()`

4. **Worker** обрабатывает `download_media` → `client.get_messages(chat, ids=[id])`
   → скачивает blob → загружает в `tg-media/<sid>/<msg_id>.<ext>` →
   `update tg_messages set media_path = ...`. Лимит на размер файла: 30 МБ
   (всё что больше — игнорируется, в UI остаётся placeholder).

5. **`_cleanup_loop`** в worker'е раз в минуту:
   - SELECT все `tg_messages` с `media_path != null`
   - Группирует по `dialog_id`, JOINит с `tg_dialog_views`
   - Если `max(last_opened_at, last_closed_at) > 5 минут назад` — добавляет
     путь в batch удаления
   - DELETE files из storage + UPDATE `media_path = null`
   - **Аватарки исключены**: пути `/avatars/` пропускаются.

6. **Outgoing медиа (SPA → TG)**: SPA заливает файл в
   `tg-media/upload/<sid>/<uuid>-<filename>`. После того как worker отправил
   через MTProto — удаляет upload-файл из storage сразу (не дожидаясь TTL).

## Альтернативы, которые рассматривали

- **Вариант A: качать всё подряд как раньше.** Отклонён — забивает storage,
  явное требование владельца не делать так.
- **Вариант B: качать всё, но cron'ом удалять через 24 часа.** Отклонён —
  всё равно лишний трафик и место на пиках. 24 часа — компромисс без явного
  выигрыша: если юзер не открыл сообщение за день, оно ему скорее всего и
  не понадобится.
- **Вариант C: signed URL прямо к Telegram (CDN proxy).** Отклонён — TG
  отдаёт файлы только через MTProto, не через HTTP. Прокси-сервер на VM
  потребовал бы хранить cookie/session на стороне ingress.
- **Вариант D: тонкие thumbnails (preview) хранить всегда, full-quality —
  по требованию.** Отклонён как преждевременная сложность; вернёмся, если
  потребуется.

## Последствия

### Положительные

- Storage расходуется только на то что юзер реально смотрит.
- 1 GB free-tier Supabase хватит на годы при таком профиле.
- Аватарки кешируются (одна загрузка на жизнь чата) — UX не страдает.
- Отдельный bucket-path для аватарок (`<sid>/avatars/`) даёт чёткое
  разделение: «постоянное» vs «эфемерное».

### Отрицательные

- При первом открытии чата с медиа — задержка ~1-3 сек на скачивание
  (UI показывает placeholder «📷 …»). Решено: `media_pending = true` +
  invalidation через realtime.
- Если юзер закрыл и за 5 мин открыл обратно — повторное скачивание,
  лишний трафик из TG. На практике редкий кейс.
- Heartbeat-нагрузка на БД: каждый открытый чат = upsert каждые 60 сек.
  Для 1 юзера незаметно. Если станет 100+ одновременных открытых чатов
  — мониторить нагрузку.
- `tg_dialog_views.last_opened_at` обновляется через RLS-policy
  юзером — потенциальная точка abuse (юзер может постоянно дёргать
  upsert). Не критично — он только сам себе шумит в БД.

### Что мониторим

- Размер bucket `tg-media` в Supabase Dashboard. Должен оставаться <100 МБ
  при нормальной активности (учитывая аватарки 50 × ~10 KB = ~500 KB и
  ~10-20 открытых-сейчас медиа).
- Логи `cleanup loop: removing N stale media files` — должна быть
  активность раз в минуту с ненулевыми N после периодов работы.
- Errors в worker: `download_media failed for tg_msg=X` — если их много,
  значит retry-логика не справляется.

## Связанные ADR

- [ADR-015: Telegram userbot (личный аккаунт)](./015-telegram-userbot.md)
  — установка инфраструктуры.
- [ADR-002: Encryption strategy](./002-encryption-strategy.md) — session
  string шифруется тем же ключом.
