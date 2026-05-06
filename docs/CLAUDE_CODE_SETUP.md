# Claude Code — настройка для максимальной автономности

> Этот гайд — про настройки **на твоей машине**, которые НЕ хранятся в репо. Их нужно сделать один раз вручную перед запуском Claude Code.

## 1. Установка Claude Code

```bash
# macOS / Linux
npm install -g @anthropic-ai/claude-code

# Или другой способ актуальной установки — см. https://docs.anthropic.com/claude-code
```

Авторизация:

```bash
claude
# Следуй инструкциям OAuth-логина с твоим Anthropic API key
```

## 2. MCP-серверы (резко повышают автономность)

MCP (Model Context Protocol) — серверы, которые дают Claude Code прямой доступ к внешним системам. **Без них** агент работает только через bash-команды; **с ними** — может делать SQL-запросы, читать GitHub issues, управлять Stripe.

### Где хранится конфигурация MCP

Зависит от платформы:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` (для Desktop), или специальный конфиг Claude Code
- Linux: `~/.config/Claude/claude_desktop_config.json`
- Точное расположение для текущей версии — спроси Claude Code: "где лежит мой MCP конфиг?"

### Какие MCP подключить для Finkley

#### 2.1 Supabase MCP — критично

Даёт Claude Code прямой доступ к БД проекта. Может:

- Делать SQL-запросы для дебага ("сколько записей в visits за вчера?")
- Видеть схему БД без угадывания
- Применять миграции напрямую (с подтверждением)
- Читать логи Supabase

**Установка:**

```bash
# Поищи актуальную инструкцию (формат меняется)
# Базовый шаблон:
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "<твой personal access token>"
      }
    }
  }
}
```

> **Безопасность:** НЕ давай доступ к проду напрямую через MCP. Используй staging проект. На прод применяй через GitHub Actions (деплой workflow), не через Claude Code.

#### 2.2 GitHub MCP — очень полезно

Управление PR, issues, CI:

- Открывать PR из ветки
- Читать комментарии в issues
- Видеть статус CI
- Закрывать issues когда merge готов

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "<твой PAT с правами на репо>"
    }
  }
}
```

PAT создаётся в GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.

Минимальные права для PAT:

- Repository: `finkley` (только этот)
- Permissions:
  - Contents: read/write
  - Pull requests: read/write
  - Issues: read/write
  - Actions: read

#### 2.3 Filesystem MCP — обычно встроен

Доступ к файловой системе репо. Скорее всего у Claude Code это уже есть из коробки.

#### 2.4 Stripe MCP — опциональный (не критично)

Полезно когда работаешь над billing-функциями:

- Видеть тестовые платежи
- Проверять webhook доставку
- Симулировать события

```json
{
  "stripe": {
    "command": "npx",
    "args": ["-y", "@stripe/mcp"],
    "env": {
      "STRIPE_API_KEY": "sk_test_..."
    }
  }
}
```

**Только test mode!** Никогда не давай Claude Code live key Stripe.

#### 2.5 Что НЕ подключать

- ❌ **Postmark MCP** — нет необходимости, шлёшь через edge function
- ❌ **Anthropic API MCP** — слой над OCR, лишнее
- ❌ **Filesystem доступ за пределы репо** — рискованно

### Проверка что MCP работают

После настройки — открой Claude Code в репо и спроси:

> "Какие MCP-серверы у тебя сейчас доступны? Покажи список tools от каждого."

Должен перечислить supabase, github, и встроенные. Если не видит — перезапусти Claude Code.

## 3. Защита `main` ветки на GitHub

**Сделать обязательно** перед тем как Claude Code начнёт пушить.

GitHub → Settings репо → Branches → Add branch protection rule:

- Branch name pattern: `main`
- Require a pull request before merging: **on**
  - Require approvals: **0** (соло-разработчик, но ставишь PR через себя)
- Require status checks to pass before merging: **on**
  - Search and select: `CI / Typecheck + Lint + Test + Build`, `CI / E2E (Playwright)`
- Require branches to be up to date before merging: **on**
- Require conversation resolution before merging: **on**
- Do not allow bypassing the above settings: **on**
- Restrict who can push to matching branches: **on** (только ты)

После этого Claude Code **не сможет** напрямую запушить в `main`. Только через PR. Это последняя линия обороны.

## 4. GitHub Secrets

Settings → Secrets and variables → Actions:

```
VITE_SUPABASE_URL_PROD
VITE_SUPABASE_ANON_KEY_PROD
VITE_SUPABASE_URL_STAGING
VITE_SUPABASE_ANON_KEY_STAGING
VITE_STRIPE_PK_TEST
VITE_STRIPE_PK_LIVE
VITE_STRIPE_PRICE_ID
VITE_SENTRY_DSN
VITE_TELEGRAM_BOT_USERNAME
SUPABASE_ACCESS_TOKEN
SUPABASE_PROD_PROJECT_REF
SUPABASE_PROD_DB_PASSWORD
SUPABASE_STAGING_PROJECT_REF
SUPABASE_STAGING_DB_PASSWORD
```

`SUPABASE_ACCESS_TOKEN` — Personal access token из Supabase Dashboard → Account → Access Tokens.

`PROJECT_REF` — найдёшь в URL Supabase Dashboard: `https://supabase.com/dashboard/project/<REF>`.

## 5. Supabase Function Secrets

После создания каждого Supabase проекта (staging и prod):

```bash
pnpm supabase link --project-ref <ref>

pnpm supabase secrets set \
  STRIPE_SECRET_KEY="sk_test_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  POSTMARK_SERVER_TOKEN="..." \
  ANTHROPIC_API_KEY="sk-ant-..." \
  GROQ_API_KEY="gsk_..." \
  SECRETS_ENCRYPTION_KEY="$(./scripts/generate-encryption-key.sh)" \
  TELEGRAM_BOT_TOKEN="..."
```

`SECRETS_ENCRYPTION_KEY` для **staging** и **prod** должен быть **разный** (если ротировать staging — это безопасно; ротировать prod — катастрофа).

## 6. Husky хуки

После клона репо:

```bash
pnpm install   # husky подхватит автоматом через scripts.prepare
chmod +x .husky/pre-commit .husky/pre-push  # если они без исполняемых прав
```

Проверка:

```bash
git commit --allow-empty -m "test"
# Должен запуститься lint-staged
```

## 7. VS Code настройки (опционально)

Для удобства работы рядом с Claude Code:

`.vscode/settings.json` (можно положить в репо как `.vscode/settings.example.json`):

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

Расширения VS Code:

- ESLint (Microsoft)
- Prettier (Prettier)
- Tailwind CSS IntelliSense (Tailwind Labs)
- Supabase (Supabase)
- Postgres (Chris Kolkman)

## 8. Anthropic API лимиты

Claude Code расходует токены. Для длинных сессий (4-6 часов) нужен **достаточный лимит**:

- Bare minimum: $20-50/мес плана API
- Realistic: $100-300/мес для активной разработки
- Лимит запросов: проверь в Anthropic Console → Settings → Limits

Если упрёшься в лимит — Claude Code подвиснет посреди задачи. Лучше сразу поднять лимит, чем дебажить "почему он перестал отвечать".

## 9. Безопасность токенов и ключей

После настройки всех MCP и секретов:

- [ ] **Никаких токенов в git** — проверить через `git log --all -p | grep -E "(sk_|whsec_|ghp_|sbp_)"`
- [ ] **`.env.local` НЕ в git** — `git ls-files | grep .env` должен вернуть только `.env.example`
- [ ] **GitHub Secret Scanning включён** — Settings → Code security → Secret scanning
- [ ] **MCP конфиг с ключами вне репо** — он на твоей машине, в репо не попадёт благодаря `.gitignore`

## 10. Чек-лист перед первой сессией Claude Code

- [ ] `pnpm install` без ошибок
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` всё зелёное
- [ ] `apps/web/.env.local` заполнен
- [ ] Supabase staging проект создан, миграции применены, типы сгенерены
- [ ] `pnpm dev` запускается, видишь placeholder
- [ ] MCP-серверы подключены (минимум: supabase staging + github)
- [ ] Branch protection на `main` включён
- [ ] GitHub Secrets заполнены
- [ ] Supabase Function Secrets установлены (staging минимум)
- [ ] Husky хуки работают (test commit прошёл lint-staged)

Если всё ✅ — открывай `PROMPTS_FOR_CLAUDE_CODE.md` и запускай **Промпт 1**.

## 11. Что делать если Claude Code тупит / зацикливается

См. `docs/runbook.md` секцию "Если Claude Code зашёл в тупик".

## 12. Что я НЕ настраивал и почему

- **Storybook** — избыточно для соло-разработчика, лучше `pnpm dev` смотреть
- **Visual regression тесты** — преждевременная оптимизация
- **Custom ESLint rules** — стандартные плагины достаточно
- **Сложный observability stack** (Datadog, Grafana) — Sentry хватает
- **Кастомные GitHub Actions** — стандартные actions из marketplace покрывают всё
