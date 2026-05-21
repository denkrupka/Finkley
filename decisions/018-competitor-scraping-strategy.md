# ADR-018: Best-effort HTML scraping для мониторинга конкурентов

## Статус

`Accepted`

Дата: 2026-05-21

## Контекст

Владелец попросил мониторинг конкурентов (`reports/Конкуренты`) с 4 типами
метрик: цены, загруженность, рейтинг и контент (постов / подписчиков /
частоты публикаций). Источники по факту:

- **Booksy** — публичных API нет, отдают `__NEXT_DATA__` JSON-блобом на
  HTML-странице салона.
- **Google Maps** — есть официальный Places API v1 (платный, бесплатный
  лимит ~10K req/мес), отдаёт rating + до 5 отзывов.
- **Instagram / Facebook** — Meta Graph API требует App Review и
  бизнес-аккаунт, привязанный к нашему собственному FB App. Для мониторинга
  чужих профилей официально не предусмотрен.

Это MVP без бюджета на Meta App Review и без юр. оснований для
платного коммерческого scraping. Нужен прагматичный путь, который
работает «обычно», и явное снижение ожиданий когда не работает.

## Решение

**Hybrid:** официальные API там где есть бесплатный/доступный тариф,
best-effort HTML scrape — для всего остального. Каждая ветка обёрнута
в try/catch и не валит весь sync.

| Метрика                     | Источник                                        | Стабильность                               |
| --------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Rating + reviews            | Google Places API v1                            | стабильно (официальный API)                |
| Цены услуг                  | Booksy `__NEXT_DATA__` scrape                   | хрупко (структура их сайта может меняться) |
| Загруженность (occupancy %) | Booksy availability в `__NEXT_DATA__`           | хрупко                                     |
| Followers/Posts/Following   | Instagram `og:description` regex                | средне (формат стабилен по факту)          |
| FB likes                    | Facebook public page regex `X people like this` | хрупко                                     |
| Posts/мес (частота)         | ISO-даты + `taken_at_timestamp` в HTML          | очень хрупко (Insta прячет данные за JS)   |

**Edge function `competitor-sync`** (cron 08:00 UTC) проходит по всем
активным конкурентам, для каждого пытается собрать snapshot. Все сборщики
изолированы — провал одного не блокирует остальные. Snapshot пишется
батчем в `competitor_snapshots(kind, data jsonb, source, snapshot_date)`.

Чистые helper'ы (`parseSocialCount`, `parseInstaOgDescription`,
`estimatePostsPerMonth`, `parseFbLikes`) вынесены в
`supabase/functions/_shared/social-metrics.ts` и покрыты unit-тестами
(22 кейса). Это позволяет проверять регрессии парсинга без живых
HTTP-запросов.

## Альтернативы, которые рассматривали

- **Только Google Places + ничего больше** — отклонено: пользователь
  явно просил Booksy цены и контент-метрики Insta/FB. Без них половина
  заявленной фичи бесполезна.
- **Платный сервис типа Apify/ScrapingBee** — €30-100/мес. Отклонено
  из-за бюджета MVP. Может быть переоценено если станет много пользователей.
- **Meta App Review + Business Verification** — 4-8 недель и требует
  юрлица + privacy policy + production server. Не для MVP-сроков.
- **Headless Chrome (Playwright/Puppeteer)** в edge function —
  Supabase Edge Functions не поддерживают (Deno без Chromium). Можно
  отдельный VPS, но это +€5/мес и +1 инфра-компонент.

## Последствия

### Положительные

- Все 4 метрики работают «обычно» бесплатно, без сторонних сервисов.
- Чистая separation: helpers в `_shared/` тестируются юнитами, fetch
  остаётся в edge function. Поломку парсинга легко чинить без передеплоя.
- Архитектура `competitor_snapshots(kind, data jsonb)` — гибкая, можно
  добавлять новые `kind` без миграций.

### Отрицательные

- Booksy и Insta scrape сломаются если они поменяют структуру HTML.
  Best-effort означает «может вернуть пусто», UI это терпит (фоллбек
  «нет данных»). Чинить — обновлением regex / `__NEXT_DATA__` парсера.
- `posts_per_month` — эвристика на найденных датах в HTML. Для Instagram
  обычно даёт null (даты не в HTML, а подгружаются JS). Это известное
  ограничение, отражено в типе `number | null`.
- Booksy/Meta могут считать наш scrape нарушением их ToS. Юридический
  риск низкий (одна-две страницы в день per salon, не агрессивный
  crawl), но существует. User-agent не маскируем под браузер
  (`FinkleyBot/1.0`), чтобы быть открытыми если кто-то спросит.

### Что мониторим

- Если `competitor-sync` логи показывают 0 snapshots для большинства
  конкурентов на протяжении 3+ дней — значит парсеры поломались,
  нужно обновить regex.
- Если Google вернёт `429 RESOURCE_EXHAUSTED` — превысили free tier;
  пересмотреть либо включить billing, либо снизить частоту cron.
- Если Booksy/Meta пришлёт юр. claim — немедленно остановить cron и
  пересмотреть подход (платный сервис / отказ от фичи).
- Если эта эвристика `posts_per_month` слишком часто возвращает null —
  рассмотреть RapidAPI / scraping-as-a-service за €10-30/мес.
