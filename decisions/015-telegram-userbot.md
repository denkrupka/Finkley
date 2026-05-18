# ADR-015: Telegram userbot (личный аккаунт) — интеграция как мессенджер

## Статус

`Proposed`

Дата: 2026-05-18

## Контекст

Цель: дать владельцу салона возможность вести переписку **со своего личного
Telegram-аккаунта** прямо из портала. Видеть все диалоги (а не только тех
клиентов, которые написали боту), читать историю, отправлять/получать
сообщения и медиа, видеть «печатает», «прочитано», реакции.

Bot API эту задачу не решает: бот — отдельная сущность, у него нет доступа
к личной переписке владельца. Нужен **userbot** через MTProto — клиентская
библиотека логинится в TG под номером телефона владельца и работает от его
имени.

Это первая в проекте «толстая» интеграция, требующая постоянно работающего
бэкенд-сервиса (Edge Functions Supabase — короткоживущие, не подходят).

## Решение

### Стек

- **Бэкенд userbot:** Python 3.11 + [Telethon](https://docs.telethon.dev/) +
  FastAPI (HTTP-bridge между Supabase и userbot-процессом).
  Telethon — наиболее зрелая Python-библиотека MTProto, проверена годами,
  поддерживает все нужные фичи (медиа, реакции, edit, delete, typing, read).
- **Хостинг:** Oracle Cloud Always Free — ARM VM (Ampere A1), регион
  Frankfurt. Бесплатно навсегда (4 OCPU / 24 GB RAM суммарно — для нашего
  MVP избыточно с большим запасом). Альтернатива при отзыве free tier —
  Hetzner CX11 (€4.51/мес).
- **Шифрование сессий:** application-level AES-256-GCM ключом
  `SECRETS_ENCRYPTION_KEY` (тот же подход что в ADR-002 для wFirma).
  Расшифровка только на стороне userbot-сервиса, **никогда** не на SPA.
- **Realtime → SPA:** userbot пишет инкрементальные апдейты в таблицы
  `tg_messages` / `tg_dialogs`, SPA подписан через Supabase Realtime
  (postgres_changes) и реактивно обновляет UI.
- **Storage медиа:** Supabase Storage bucket `tg-media`, signed URLs
  (как `receipts/` сейчас). Userbot скачивает blob из TG, заливает в
  bucket, в `tg_messages.media_path` пишет путь.

### Архитектура

```
┌──────────────────┐         ┌─────────────────────┐         ┌──────────────┐
│  SPA (Vite SPA)  │ ──HTTP→ │  Supabase Postgres  │ ←────── │ Oracle VM    │
│  /messenger      │         │  + Realtime         │  push   │ tg-userbot   │
│                  │ ←Realtime│  tables:           │  rows   │ (Python +    │
│  - dialogs list  │  rows   │   tg_sessions       │ ───────▶│ Telethon +   │
│  - chat window   │         │   tg_dialogs        │  read   │ FastAPI)     │
│  - send box      │         │   tg_messages       │  outbox │              │
│                  │ ──HTTP→ │   tg_outbox         │         │  ↑           │
└──────────────────┘  via    │   tg_auth_flows     │         │  │ MTProto   │
                     bridge  └─────────────────────┘         │  │ TLS:443   │
                     (auth                                   │  ↓           │
                     code)                                   │ Telegram DCs │
                                                             └──────────────┘
```

Поток отправки сообщения:

1. SPA пишет INSERT в `tg_outbox` (queue) через Supabase JS клиента.
2. Userbot слушает Realtime по `tg_outbox`, на новую строку — выполняет
   `client.send_message()` через MTProto.
3. На успех — INSERT в `tg_messages` (status=`sent`), UPDATE outbox status.
4. SPA реактивно показывает доставленное сообщение через Realtime.

Поток входящих:

1. Telethon-клиент держит соединение, на `events.NewMessage` срабатывает
   handler.
2. Handler INSERT в `tg_messages` (+ скачивает медиа в bucket если есть).
3. SPA по Realtime подписке мгновенно отрисовывает.

### Auth flow

1. SPA: ввод номера телефона (PL/RU/UA в формате E.164) →
   POST `https://userbot.finsalon.app/auth/start` с `salon_id` + `phone`.
2. Userbot создаёт Telethon-клиент, вызывает `client.send_code_request(phone)` →
   TG присылает 5-значный код в **другое TG-устройство** владельца.
3. SPA: ввод кода → POST `/auth/code` с `auth_flow_id` + `code`.
4. Если 2FA включена → SPA показывает ввод пароля → POST `/auth/2fa`.
5. На успех: получаем session string, **шифруем + INSERT в `tg_sessions`**.
6. SPA редиректит в `/messenger`, видит свои диалоги.

Логаут: SPA POST `/auth/logout` → userbot вызывает `client.log_out()`
(инвалидирует session на стороне Telegram) → DELETE строки из `tg_sessions`.

### Структура БД (новая миграция)

```sql
create table tg_sessions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid not null references auth.users(id),  -- кто из members подключил свой TG
  phone text not null,
  session_encrypted text not null,                   -- AES-GCM(SECRETS_ENCRYPTION_KEY)
  tg_user_id bigint,                                  -- ID юзера в TG
  tg_username text,                                   -- @username (опционально)
  tg_first_name text,
  status text not null default 'active',              -- active | revoked | error
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table tg_sessions enable row level security;
-- RLS: видит только тот, кто подключил свою сессию (user_id=auth.uid())

create table tg_dialogs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tg_sessions(id) on delete cascade,
  tg_chat_id bigint not null,                        -- ID чата в TG
  type text not null,                                 -- user | group | channel
  title text,
  username text,
  last_message_text text,
  last_message_at timestamptz,
  unread_count int default 0,
  pinned boolean default false,
  archived boolean default false,
  created_at timestamptz default now(),
  unique (session_id, tg_chat_id)
);

create table tg_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tg_sessions(id) on delete cascade,
  dialog_id uuid not null references tg_dialogs(id) on delete cascade,
  tg_message_id bigint not null,                      -- ID в TG для дедупа
  from_tg_user_id bigint,                              -- кто прислал (null = сам)
  is_outgoing boolean not null,
  text text,
  media_kind text,                                     -- photo | video | document | voice | null
  media_path text,                                     -- путь в Supabase Storage
  reply_to_tg_message_id bigint,
  reactions jsonb,                                     -- [{emoji,count,chose_by_me}]
  edited_at timestamptz,
  deleted boolean default false,
  sent_at timestamptz not null,
  created_at timestamptz default now(),
  unique (session_id, tg_message_id)
);

create table tg_outbox (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tg_sessions(id) on delete cascade,
  dialog_id uuid not null references tg_dialogs(id),
  action text not null,                                -- send_text | send_media | edit | delete | react | mark_read | typing
  payload jsonb not null,
  status text not null default 'pending',              -- pending | sent | failed
  attempts int default 0,
  last_error text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create table tg_auth_flows (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  phone text not null,
  phone_code_hash text,                                -- от send_code_request
  state text not null default 'awaiting_code',         -- awaiting_code | awaiting_2fa | done | failed
  expires_at timestamptz not null,                     -- TTL 10 мин
  created_at timestamptz default now()
);
```

Все таблицы под RLS: пользователь видит только свои сессии (`user_id=auth.uid()`).
Userbot-сервис ходит через **service role key** — он системный.

### MVP scope (Phase 1 — ~3 недели)

✅ В MVP:

- Auth flow phone → code → 2FA → encrypted session
- Список диалогов (last 50)
- Открытие чата, история (lazy-load порциями по 50)
- Отправка текстового сообщения
- Приём текстовых сообщений в realtime
- Логаут

❌ НЕ в MVP (Phase 2+):

- Медиа (фото/видео/файлы) — отдельный sprint
- Реакции, edit, delete
- Typing indicator, read receipts
- Group/channel management (только direct DM работает)
- Поиск по чатам
- Voice messages

### Безопасность

- `session_encrypted` шифруется и расшифровывается **только** на userbot-сервисе
  (env `SECRETS_ENCRYPTION_KEY` — тот же что у wFirma).
- Userbot процесс работает под non-root user (`tg-userbot`), session-файлы
  Telethon кэширует только в RAM (in-memory session) — на диске не оседают.
- SSH-доступ к Oracle VM только по ключу (no password), порт 22 firewall'ом
  ограничен IP-диапазоном владельца.
- Userbot слушает HTTP на 127.0.0.1, наружу — через nginx reverse proxy с
  Let's Encrypt SSL. Endpoint защищён JWT от Supabase auth.
- В логах никогда не печатать: session string, phone code, 2FA password,
  decrypted MTProto blobs.
- Backup `tg_sessions` — только зашифрованные строки (in-place в Postgres
  backup'ах Supabase, никаких отдельных копий ключа).

### Юридика и риски

⚠ **Telegram ToS формально запрещает userbots** (раздел 4.1: «no automated
clients without explicit permission»). На практике массово используются для
автоматизации, банят за подозрительные паттерны (массовая рассылка,
скрейпинг). Наш кейс — single-user, low-volume, реальная человеческая
переписка — самый безопасный профиль.

Митигация:

1. **Onboarding-предупреждение:** при подключении показываем юзеру
   красным: «Telegram может временно ограничить или заблокировать аккаунт.
   Используешь на свой риск. Не используй для массовых рассылок».
2. **Privacy Policy + ToS update:** упоминаем, что хранится session string,
   объясняем что не читаем переписки (RLS), даём кнопку «удалить все
   TG-данные».
3. **Rate limits:** в коде ограничиваем — не более 30 send/min на сессию.
4. **GDPR:** в `tg_messages` лежат сообщения от **третьих лиц** (клиентов
   салона). По польскому RODO это персональные данные. Нужно:
   - DPA-договор с пользователем (как Data Processor)
   - Retention policy: удаление tg_messages при удалении tg_sessions
   - Right-to-erasure: кнопка «удалить переписку с X»

Эти юридические шаги — **обязательны до beta-релиза**, не до MVP-теста на
владельце.

### Cost

- Oracle Cloud Always Free: 0 zł (потенциально навсегда, но Oracle режет
  inactive VMs — будем держать workload userbot'а постоянно).
- Domain/subdomain: `userbot.finsalon.app` — реюз существующего домена.
- SSL: Let's Encrypt автомат.
- Резерв: если Oracle прекратит free tier → Hetzner CX11 €4.51/мес.

### Что мониторим

- **Telegram аккаунт владельца не банят** в течение 1 месяца alpha — если
  банят, делаем emergency rollback на Bot API режим (ограниченные фичи).
- **CPU/RAM Oracle VM** — если >50% от free tier, скейлимся горизонтально
  (1 процесс на N юзеров вместо 1:1).
- **MTProto reconnect frequency** — частые reconnect'ы = плохая сеть VM →
  переезд в другой регион Oracle.
- **Encryption key rotation** — раз в год ротируем `SECRETS_ENCRYPTION_KEY`
  с re-encrypt процедурой (как для wFirma).

## Альтернативы, которые рассматривали

- **Bot API:** не даёт доступа к личной переписке владельца. Решает
  максимум 30% случаев (клиент → бот → салон). Владелец явно отверг.
- **Открыть web.telegram.org в iframe:** TG блокирует X-Frame-Options
  iframe-encapsulation. Можно `target=_blank` ссылка, но никакой
  интеграции с CRM нет.
- **gramjs (Node.js):** альтернатива Telethon. Менее зрелый, документация
  слабее, меньше StackOverflow ответов. Отклонено — Telethon более
  проверен в production.
- **Pyrogram:** ещё один Python MTProto клиент. Активно развивается, но
  плагинная архитектура хуже подходит под наш use-case. Telethon
  предпочтительнее.
- **MadelineProto (PHP):** мог бы запуститься на shared-хостинге.
  Отклонено — PHP-инфра у нас не используется, новый стек = новые
  проблемы. Качество кода ниже Telethon.
- **Render/Railway free tier:** засыпают/режут лимиты. Не подходит для
  24/7 userbot.

## Последствия

### Положительные

- Полнофункциональный мессенджер в портале — киллер-фича для целевой
  аудитории (салоны, где общение с клиентами — основной канал).
- Реюз encryption pattern из ADR-002 → нет нового способа управления
  секретами.
- Oracle Always Free = 0 zł инфры на старте.
- Архитектура расширяема: легко добавить WhatsApp Business API (другой
  worker на той же VM, тот же outbox-паттерн).

### Отрицательные

- **Новая инфра-вертикаль:** Python-сервис вне Supabase. Новый deploy
  pipeline (SSH + systemd), новый мониторинг, новые runbook'и.
- **Юридический риск** TG ToS — митигирован onboarding-предупреждением,
  но не устранён полностью.
- **GDPR-нагрузка:** хранение чужих сообщений = новые DPA, retention,
  right-to-erasure — нужно юридическое сопровождение.
- **Single point of failure:** Oracle VM падает = весь мессенджер лежит.
  Для MVP это OK, для prod нужен failover (Phase 3+).
- **Зависимость от Oracle free tier policy:** если режут — миграция
  на Hetzner.

## План реализации (после approve ADR)

1. **Owner:** заводит Oracle Cloud account, создаёт ARM VM (Ampere A1)
   в регионе Frankfurt, выдаёт SSH-доступ. Чеклист — отдельный документ.
2. Создаю Supabase миграцию `2026XXXX_tg_userbot_tables.sql` со всеми
   таблицами и RLS.
3. Скелет сервиса `services/tg-userbot/`:
   - `app.py` — FastAPI bridge endpoints (`/auth/start`, `/auth/code`, etc.)
   - `worker.py` — Telethon event loop + outbox listener
   - `requirements.txt`, `Dockerfile`, `systemd/tg-userbot.service`
   - `deploy.sh` — git pull + restart на Oracle VM
4. SPA: `apps/web/src/routes/messenger/` — список диалогов + чат-view.
5. Auth-flow UI: модалка в Настройки → Интеграции → Соцсети.
6. Alpha-тест на личном TG владельца — 1 неделя.
7. Beta с 2-3 friendly юзерами (предупреждение про риск) — 2 недели.
8. Public — после юридического review (Privacy + ToS + DPA).
