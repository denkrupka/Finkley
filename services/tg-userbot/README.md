# tg-userbot — Telegram userbot bridge

Bridge между Supabase / SPA Finkley и MTProto-клиентом Telethon. См. **ADR-015**
для архитектуры, безопасности и юридики.

## Что делает

- **HTTP API** (FastAPI на 127.0.0.1:8000): `/auth/start`, `/auth/code`, `/auth/2fa`,
  `/sessions/{id}/logout`, `/health`. SPA вызывает через `https://userbot.finkley.app`.
- **Background worker** (Telethon): для каждой `tg_sessions.status='active'`:
  - Поднимает `TelegramClient(StringSession(decrypt(session_encrypted)))`
  - Подписывается на `events.NewMessage` → пишет в `public.tg_messages`
  - Каждую секунду опрашивает `public.tg_outbox` на новые pending-actions для
    своих сессий → выполняет (send_text/edit/delete/react/typing/mark_read)

## Деплой

Production-инстанс: Oracle Cloud VM `134.98.128.78` (Amsterdam), Ubuntu 22.04.
Доступ через nginx reverse proxy на `https://userbot.finkley.app` (Let's Encrypt).

```bash
# Локально из корня репо
cd services/tg-userbot
SSH_KEY=D:/FINSALON_KEY/ssh-key-2026-05-18.key bash deploy.sh
```

Что делает `deploy.sh`:

1. rsync кода в `/tmp/tg-userbot-deploy/` на VM
2. Перемещает в `/opt/tg-userbot/` (исключая venv и .env)
3. Создаёт/обновляет venv, ставит deps из `requirements.txt`
4. `systemctl restart tg-userbot`

## Первичная настройка VM

Один раз после клонирования:

```bash
ssh ubuntu@134.98.128.78
sudo cp /opt/tg-userbot/services/tg-userbot/systemd/tg-userbot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tg-userbot

# Создать /opt/tg-userbot/.env (вручную, mode 600)
sudo -u tg-userbot vim /opt/tg-userbot/.env
# Скопировать .env.example, заполнить SUPABASE_* и SECRETS_ENCRYPTION_KEY
sudo chmod 600 /opt/tg-userbot/.env

sudo systemctl start tg-userbot
sudo systemctl status tg-userbot
```

## Локальная разработка

```bash
cd services/tg-userbot
python3 -m venv venv
source venv/bin/activate  # или venv\Scripts\activate на Windows
pip install -r requirements.txt
cp .env.example .env  # заполнить
uvicorn app.main:app --reload --port 8000
```

## Структура

```
services/tg-userbot/
├── app/
│   ├── main.py            # FastAPI app + worker startup
│   ├── config.py          # pydantic Settings из env
│   ├── crypto.py          # AES-GCM encrypt/decrypt sessions
│   ├── auth_jwt.py        # Validate Supabase JWT from Authorization header
│   ├── supabase_client.py # service_role REST client
│   ├── tg_client.py       # TelegramClient helpers
│   ├── worker.py          # Background event loop + outbox poller
│   └── routes/
│       ├── auth_router.py # /auth/start, /auth/code, /auth/2fa
│       └── health_router.py
├── systemd/tg-userbot.service
├── deploy.sh
├── requirements.txt
├── .env.example
└── README.md
```

## Безопасность

- `session_encrypted` шифруется AES-256-GCM ключом `SECRETS_ENCRYPTION_KEY`,
  расшифровка ТОЛЬКО на bridge-сервисе. На клиент session-string не уходит никогда.
- Все mutate-endpoints требуют `Authorization: Bearer <supabase_jwt>`, JWT
  проверяется по `SUPABASE_JWT_SECRET` (HS256). User-id из JWT должен совпадать
  с `user_id` в payload запроса.
- `.env` файл mode 600, owner tg-userbot, никогда не коммитится.
- Сервис слушает только на 127.0.0.1; nginx — единственный путь снаружи.
- Telethon хранит `StringSession` в RAM, на диск ничего не пишет.

## Логи и мониторинг

```bash
# Live логи
sudo journalctl -u tg-userbot -f

# Последние 100 строк
sudo journalctl -u tg-userbot -n 100 --no-pager

# Перезапуск
sudo systemctl restart tg-userbot
```
