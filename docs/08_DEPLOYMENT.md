# 08. Deployment

## Стек деплоя

- **Фронт (SPA + Landing):** GitHub Pages через GitHub Actions
- **Бэк:** Supabase (миграции БД + Edge Functions)
- **Custom domain:** Cloudflare DNS, прокси для CDN/SSL/Headers
- **CI/CD:** GitHub Actions
- **VPS:** нет
- **Vercel/Netlify:** нет

## Окружения

| Окружение    | URL                                            | Supabase                         | Когда деплоится                       |
| ------------ | ---------------------------------------------- | -------------------------------- | ------------------------------------- |
| `local`      | localhost:5173 (app), localhost:4321 (landing) | локальный через `supabase start` | При `pnpm dev`                        |
| `staging`    | `staging.finkley.app`                          | `finkley-staging`                | На каждый PR + push в `staging` ветку |
| `production` | `app.finkley.app` + `finkley.app`              | `finkley-prod`                   | На push в `main`                      |

## DNS-схема (Cloudflare)

```
finkley.app               → CNAME → username.github.io  (proxied)
                            └─ путь: /                    (Astro landing)
www.finkley.app           → CNAME → finkley.app           (proxied)
app.finkley.app           → CNAME → username.github.io    (proxied)
                            └─ путь: /app/                (Vite SPA)
staging.finkley.app       → CNAME → username.github.io    (proxied)
                            └─ путь: /app-staging/        (Vite SPA preview)
```

В Cloudflare включить:

- **Always Use HTTPS:** ✓
- **HSTS:** включить через 30 дней после стабильной работы
- **Brotli compression:** ✓
- **Browser cache TTL:** 4 hours
- **Page Rules** или **Transform Rules** для пути `/app/*` → no cache (SPA с динамическим контентом)

## GitHub Pages конфигурация

**Source:** Branch `gh-pages`, folder `/`.

**Структура `gh-pages` ветки:**

```
gh-pages/
├── index.html          # Astro landing
├── pricing/index.html
├── privacy/index.html
├── terms/index.html
├── _astro/             # Astro assets
├── app/                # Vite SPA
│   ├── index.html
│   ├── assets/
│   └── 404.html        # для SPA fallback
└── app-staging/        # Vite SPA staging build
    └── ...
```

**Custom domains:**

- В настройках GitHub репо → Pages → Custom domain: `finkley.app`
- В корне `gh-pages` → файл `CNAME` с содержимым `finkley.app`
- GitHub автоматически выдаст SSL через Let's Encrypt (но мы используем Cloudflare proxy, поэтому Cloudflare даёт SSL)

## SPA Routing на GitHub Pages

GitHub Pages по умолчанию возвращает 404 на любой путь, кроме физического файла. Для SPA с client-side routing это проблема.

**Решение — `404.html` fallback** (стандартный паттерн `spa-github-pages`):

В `app/public/404.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <script>
      var path = window.location.pathname
      var search = window.location.search
      var hash = window.location.hash
      var basePath = '/app/'
      window.location.replace(
        basePath +
          '?p=' +
          encodeURIComponent(path.replace(basePath, '')) +
          search.replace('?', '&') +
          hash,
      )
    </script>
  </head>
  <body>
    Loading...
  </body>
</html>
```

В `app/src/main.tsx` (до рендеринга):

```javascript
;(function () {
  var match = window.location.search.match(/[?&]p=([^&]+)/)
  if (match) {
    var path = '/app/' + decodeURIComponent(match[1])
    var rest = window.location.search.replace(/[?&]p=[^&]*/, '').replace(/^&/, '?')
    window.history.replaceState(null, '', path + rest + window.location.hash)
  }
})()
```

См. https://github.com/rafgraph/spa-github-pages

## GitHub Actions

### `.github/workflows/checks.yml` — CI на PR

```yaml
name: Checks

on:
  pull_request:
    branches: [main, staging]

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

### `.github/workflows/deploy.yml` — Деплой при push в main

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile

      - name: Build app
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL_PROD }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY_PROD }}
          VITE_PLAUSIBLE_DOMAIN: ${{ secrets.PLAUSIBLE_DOMAIN }}
          VITE_SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
        run: pnpm --filter app build

      - name: Build landing
        env:
          PUBLIC_PLAUSIBLE_DOMAIN: ${{ secrets.PLAUSIBLE_DOMAIN }}
        run: pnpm --filter landing build

      - name: Assemble deploy directory
        run: |
          mkdir -p .deploy/app
          cp -r landing/dist/* .deploy/
          cp -r app/dist/* .deploy/app/
          echo "finkley.app" > .deploy/CNAME

      - name: Deploy to gh-pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./.deploy
```

### `.github/workflows/supabase-migrate.yml`

```yaml
name: Supabase Migrate

on:
  push:
    branches: [main]
    paths:
      - 'supabase/migrations/**'
      - 'supabase/functions/**'

jobs:
  migrate-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF_STAGING }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - run: supabase db push
      - run: supabase functions deploy

  migrate-production:
    needs: migrate-staging
    runs-on: ubuntu-latest
    environment: production-database # требует manual approval
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF_PROD }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - run: supabase db push
      - run: supabase functions deploy
```

**Manual approval** для production устанавливается в GitHub Settings → Environments → `production-database` → Required reviewers.

## Секреты

### GitHub repository secrets

```
SUPABASE_URL_PROD              # https://xxx.supabase.co
SUPABASE_ANON_KEY_PROD         # eyJ...
SUPABASE_URL_STAGING           # https://yyy.supabase.co
SUPABASE_ANON_KEY_STAGING      # eyJ...
SUPABASE_ACCESS_TOKEN          # personal access token для CLI
SUPABASE_PROJECT_REF_PROD      # xxx
SUPABASE_PROJECT_REF_STAGING   # yyy
PLAUSIBLE_DOMAIN               # finkley.app
SENTRY_DSN                     # https://...@sentry.io/...
```

### Supabase Edge Function secrets

(не коммитятся, ставятся через `supabase secrets set --project-ref <ref>`)

```
SECRETS_ENCRYPTION_KEY         # 32 байта base64 — для шифрования Booksy/wFirma токенов
STRIPE_SECRET_KEY              # sk_live_...
STRIPE_WEBHOOK_SECRET          # whsec_...
POSTMARK_SERVER_TOKEN          # для отправки email
ANTHROPIC_API_KEY              # для OCR
GROQ_API_KEY                   # OCR fallback
TELEGRAM_BOT_TOKEN             # для Telegram Login валидации
```

### Локальный `.env.local` (gitignored)

```bash
# app/.env.local
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJ...local
VITE_PLAUSIBLE_DOMAIN=  # пусто на локалке
VITE_SENTRY_DSN=        # пусто на локалке

# supabase/.env (для локальной разработки edge functions)
SECRETS_ENCRYPTION_KEY=test_key_32_bytes_base64_encoded_xxxxxxxxxxxxx=
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_test_...
POSTMARK_SERVER_TOKEN=test_token
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
```

## Локальная разработка

```bash
# Терминал 1: локальный Supabase (требует Docker)
supabase start

# Терминал 2: SPA
pnpm --filter app dev
# → http://localhost:5173

# Терминал 3: Landing
pnpm --filter landing dev
# → http://localhost:4321

# Терминал 4 (опционально): Edge Functions
supabase functions serve --env-file ./supabase/.env
```

### Команды Supabase CLI

```bash
supabase migration new add_some_table   # создать миграцию
supabase db reset                        # сбросить и применить заново
supabase db push --linked                # применить к удалённому проекту
supabase gen types typescript --local > app/src/types/database.ts
supabase functions new my-function       # создать новую edge function
supabase functions serve                  # запустить все локально
```

## Stripe webhook на локалке

```bash
stripe login
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
# выдаст whsec_... — положить в supabase/.env как STRIPE_WEBHOOK_SECRET
```

Для тестирования событий:

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```

## Rollback

### Если фронт сломал прод

1. `git revert <bad_commit>` в main
2. `git push` — автодеплой через 1-2 минуты вернёт всё назад
3. Или вручную в GitHub Actions → Re-run workflow для предыдущего успешного билда

### Если миграция БД сломала прод

1. Если миграция не удаляла данные — написать **компенсирующую миграцию** (обратная) и применить
2. Если удаляла — **восстанавливать из бэкапа Supabase**:
   - Supabase Dashboard → Database → Backups → выбрать дату → restore
   - **Только в крайнем случае**, простой будет несколько минут
3. Постмортем в `docs/incidents/YYYY-MM-DD-rollback.md`

**Правило:** никогда не пишем миграцию, которая удаляет колонку или таблицу в одном PR.

- PR 1: добавляет новую колонку, копирует данные, помечает старую `DEPRECATED`
- PR 2 (через несколько недель): удаляет старую

### Если Edge Function сломал прод

```bash
git revert <bad_commit>
supabase functions deploy <function-name> --project-ref <prod>
```

Edge Function-ы не имеют состояния, rollback мгновенный.

## Мониторинг

### Health checks

- `app.finkley.app` — UptimeRobot (free tier, 5 минут интервал)
- `finkley.app` — UptimeRobot
- Supabase: дашборд показывает uptime
- Stripe: `https://status.stripe.com/`
- Анонимный health-check endpoint: `app.finkley.app/health.json` (статика)

### Алерты

- Sentry → email при `error` уровне
- UptimeRobot → email при downtime > 2 минут
- Supabase: внутренние алерты на CPU/disk (free tier — только email)

### Метрики

- Plausible — органический трафик и события (signup, payment)
- Sentry — частота ошибок
- Supabase Dashboard — DB usage, API requests, edge function invocations

## Backups

### Supabase

- Free tier: ежедневные бэкапы, retention 7 дней
- Pro tier: ежедневные + PITR, retention 30 дней
- Дополнительно: вручную раз в неделю `pg_dump` (можно через GitHub Actions cron)

### Storage (фото чеков)

- Supabase Storage даёт встроенный бэкап
- Дополнительно ничего не делаем

### Код

- GitHub — это наш бэкап
- Дополнительно ничего не нужно

## Чек-лист первого прод-деплоя

- [ ] Все секреты в GitHub repository secrets установлены
- [ ] Все Supabase Edge Function secrets установлены
- [ ] Custom domain настроен в Cloudflare и в GitHub Pages
- [ ] SSL сертификат активен (Cloudflare)
- [ ] Stripe webhook URL прописан: `https://<supabase-prod>.supabase.co/functions/v1/stripe-webhook`
- [ ] Postmark Sender Signature подтверждён (DKIM/SPF/DMARC)
- [ ] Sentry DSN правильный (production project)
- [ ] Plausible site создан для домена
- [ ] UptimeRobot мониторы настроены
- [ ] Privacy Policy / Terms / Cookies опубликованы на лендинге
- [ ] Health check `/health.json` отвечает 200
- [ ] Тестовая регистрация → checkout → payment в test mode прошла полностью
- [ ] Smoke test: signup live, login live, создать визит live
