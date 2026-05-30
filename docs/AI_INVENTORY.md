# AI Prompts Inventory — Finkley

> Полный реестр всех AI-функций в проекте, источники данных, слабости.
> Составлено 30 мая 2026, в ходе аудита AI-промтов на портале.

## Кратко

- **12 edge functions** с прямыми вызовами AI-провайдеров (Anthropic + Groq)
- **0 клиентских вызовов** AI — SPA только дёргает edge functions (service key защищён)
- Все ключи провайдеров в Supabase secrets

## Таблица функций

| #   | Function                              | Provider / Model                                        | Data source                                                                                                       | Max tokens / Temp    | Tools                                                        | Weaknesses                                                                                                          |
| --- | ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **ai-assistant**                      | Anthropic `claude-haiku-4-5-20251001`                   | RPC `ai_salon_snapshot(salon_id)` → KPI + history из `ai_messages`                                                | 2048 / default       | 5 tools (create_visit/expense/client/service, transfer_cash) | Snapshot обрезан до 30 staff/30 services. История только last 10 plain-text. Suggestions hardcoded if-else, не AI.  |
| 2   | **ai-onboarding-preview**             | Anthropic `claude-haiku-4-5-20251001`                   | До early-create salon: payload wizard. После: REAL DATA из БД (staff, services, visits 30d/60d/90d, top, reviews) | 2200 / default       | нет                                                          | 3 режима (insights/full_summary/breakdown). Курс валют hardcoded. Money без копеек.                                 |
| 3   | **ai-report-insights**                | Anthropic `claude-haiku-4-5-20251001`                   | Payload готов из клиента (агрегаты)                                                                               | 1500 / default       | нет                                                          | 8 видов prompt. Инструкции захардкожены по-русски. Микс RU/EN. Если payload пустой — AI всё равно сгенерит воды.    |
| 4   | **reviews-ai-analyze**                | Anthropic `claude-haiku-4-5-20251001`                   | 1-50 reviews + JOIN staff/visit_items. Кеш по payload_hash                                                        | 4096 / default       | нет                                                          | Жёсткие инструкции по языку дублируются 3 раза. Body отзыва обрезан до 800 chars. risk_assessment свободная строка. |
| 5   | **generate-insights** (weekly cron)   | Anthropic `claude-haiku-4-5-20251001`                   | RPC `insights_salon_data` → агрегаты. TS-rules engine first, Claude polish                                        | 1500 / default       | нет                                                          | AI как "polish" — основная логика в `runRules()`. Russian hardcoded в TS-rule body.                                 |
| 6   | **ai-seo-helper**                     | Anthropic `claude-haiku-4-5-20251001`                   | body_html + target_keyword из админ-формы                                                                         | 400-1500 (по action) | нет                                                          | 6 actions. System prompts захардкожены по-русски. OK так как тулза для команды Finkley.                             |
| 7   | **ocr-receipt**                       | Anthropic `claude-haiku-4-5-20251001` (vision)          | base64 фото чека (≤4MB)                                                                                           | 600 / default        | нет                                                          | category_guess закрытый список (9 категорий) — для UA/EU может не подойти.                                          |
| 8   | **ocr-notebook**                      | Anthropic `claude-sonnet-4-6` (vision)                  | base64 фото блокнота (≤2MB)                                                                                       | 4000 / default       | нет                                                          | Sonnet (дорого). client_name/master строками, не резолвятся в id. Currency не возвращается.                         |
| 9   | **inventory-ocr**                     | Anthropic `claude-haiku-4-5-20251001` (vision/document) | base64 image (≤4MB) или PDF (≤10MB)                                                                               | 2000 / default       | нет                                                          | unit_cost_cents AI считает сам — потенциальная ошибка округления. unit нормализуется в russian-only.                |
| 10  | **dictate-expense**                   | Groq `whisper-large-v3` + `llama-3.3-70b-versatile`     | Audio blob (RU hardcoded)                                                                                         | temp 0.1, json       | нет                                                          | Whisper жёстко `language: 'ru'`. PL/EN распознаются плохо. Категории hardcoded.                                     |
| 11  | **extract-counterparty-ai** (banking) | Groq `llama-3.3-70b-versatile`                          | До 50 bank_transactions per call                                                                                  | temp 0.1, json       | нет                                                          | Few-shot заточен под польские банки. Не использует словарь counterparties — может создать дубли.                    |
| 12  | **telegram-bug-collector**            | Anthropic `claude-haiku-4-5-20251001` + Groq Whisper    | Telegram webhook                                                                                                  | 250-500 / default    | нет                                                          | All RU. **Потенциальный StackOverflow** на больших Uint8Array (`String.fromCharCode(...bytes.slice(0, 4MB))`).      |

## Cross-cutting weaknesses

1. **Нет централизованного AI-клиента.** Каждая функция дублирует `fetch('https://api.anthropic.com/v1/messages')` с одними headers. Замена модели = 12 коммитов.
2. **Нет retry на 429/5xx.** Любая функция падает с `claude X` → юзер видит ошибку. Особенно болезненно для onboarding.
3. **Нет tracking токенов/стоимости.** Только `ai-assistant` сохраняет input/output_tokens в `ai_messages`. Нет дашборда $/салон/мес.
4. **JSON parsing хрупкий.** Все используют `text.match(/\{[\s\S]*\}/)` — greedy match ломается если Claude вернёт несколько JSON-блоков.
5. **Локализация дублируется.** Каждая функция имеет свой `normalizeLocale` + `systemForLocale`. Нет shared util.
6. **Tool-use только в ai-assistant.** Остальные — pure JSON-prompting. Function-calling дал бы стабильнее JSON чем regex match.
7. **No prompt caching.** Anthropic поддерживает cache_control breakpoints — system prompts в `ai-assistant` и `reviews-ai-analyze` идеально подходят. Оверплачивается ~5x на входных токенах.
8. **Абстрактные prompt у конкурентских insights** (`ai-report-insights`): `promptForCompetitorsPrices` микс RU/EN → Claude скатывается в обобщения без конкретных значений.

## Recommendations roadmap

### Phase 1 — Quick wins (done в этой сессии через подагентов)

- [x] Усилить ai-assistant system prompt (GROUNDING + anti-вода + конкретный формат)
- [x] Усилить ai-onboarding-preview (insights/breakdown/full_summary)
- [x] Усилить ai-report-insights (8 видов prompt)
- [x] Усилить reviews-ai-analyze, generate-insights, ai-seo-helper

### Phase 2 — Infra (отдельный спринт)

- [ ] Shared `_shared/ai-client.ts` — централизованный клиент с retry, timeout, token tracking
- [ ] Shared `_shared/locale.ts` — i18n util для AI промтов
- [ ] Tool-use вместо JSON match для structured output (где применимо)
- [ ] Prompt caching на длинных system prompts (ai-assistant, reviews-ai-analyze)
- [ ] Dashboard $/salon/month — sum input+output tokens × pricing

### Phase 3 — Локализация AI

- [ ] dictate-expense: распознать язык салона (PL/EN/RU) автоматом
- [ ] inventory-ocr: unit на языке салона
- [ ] ai-report-insights: убрать микс RU/EN в промтах конкурентов

### Phase 4 — Безопасность/качество

- [ ] telegram-bug-collector: чинить StackOverflow на 4MB Uint8Array
- [ ] reviews-ai-analyze: risk_assessment → enum (low/medium/high)
- [ ] ocr-notebook: резолв client_name/master в id на этапе AI через RPC
- [ ] extract-counterparty-ai: словарь counterparties → меньше дублей
