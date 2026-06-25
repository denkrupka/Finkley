# Marketing & SEO аудит (по marketing-скиллам)

> Прогон по скиллам: seo-audit, ai-seo, schema, copywriting, marketing-psychology,
> pricing, offers, onboarding, emails, sms, launch, marketing-ideas, product-marketing,
> programmatic-seo. Цель — ранжироваться в поисковиках и AI-движках + усилить конверсию.
> Ветка: `feat/marketing-seo`.

## Стратегические решения владельца (2026-06-25)

- **Язык/рынок:** двуязычно — RU остаётся основным сейчас, PL добавляем поверх
  (польские версии ключевых страниц + правильный hreflang/SSR). Целевые сегменты:
  русско/украиноязычные владельцы салонов в Польше + польский рынок.
- **Глубина правок копирайта:** активно улучшать под SEO/психологию (не только мета).

## Архитектура (важно для SEO)

- SEO-поверхность = статический Astro-лендинг `apps/landing/` (SSG, домен-корень).
- SPA `apps/web/` — пустой клиентский shell, под `/app/`, для SEO почти бесполезен
  (кроме блога `/media`, который дублируется и в лендинге через `db-posts.ts`).
- Блог: `media_posts` (Supabase) + markdown content-collection, мерджатся в билде.

## Сделано

### Phase 1 — Технический SEO + structured data ✅ (commit 0890ae2)

- Layout: проп `jsonLd` для постраничной schema; site-wide `WebSite` schema;
  preconnect Google Fonts (LCP).
- index: добавлено meta description (флагман был без него); FAQPage schema (8 Q&A);
  SEO-заголовок с ключом.
- pricing: Product schema с offers по 6 тарифам; FAQPage (7 Q&A); BreadcrumbList.
- media/[slug]: ogType=article + BlogPosting schema; media/index: Blog + BreadcrumbList.
- robots.txt: явное разрешение AI-краулеров (GPTBot, ChatGPT-User, OAI-SearchBot,
  PerplexityBot, ClaudeBot, anthropic-ai, Google-Extended).

### Phase 2 — AI-SEO машиночитаемые файлы ✅ (commit 0890ae2)

- `public/llms.txt` (llmstxt.org-формат), `public/pricing.md` (прайс для AI-агентов).

### Phase 3 — On-page копирайт feature-страниц ✅ (commit 362a3dc)

- Заголовки 50-60 символов с ключами; descriptions 150-160; answer-блоки (40-60 слов)
  на ai/integrations для AI-цитирования; breadcrumb на 3 feature-страницах;
  CTA усилены present-bias + risk-reversal.

### Phase 4 — Психология цен ✅ (commit 02684d2)

- Risk-reversal вынесен над тарифами; mental-accounting reframe (€19 = «меньше
  одного маникюра»); привязка к outcome.

## Осталось (следующие итерации)

### Phase 5 — Onboarding / Emails / SMS (in-product) — ИНВЕНТАРЬ ГОТОВ

Провайдер email — Resend; шаблоны inline в `supabase/functions/send-email/templates.ts`
(+ зеркало в `docs/email-templates/`). SMS — мультипровайдер (`_shared/sms.ts`:
smsapi/flysms/twilio, по умолчанию `none`). Крон — pg_cron + rendezvous-token.

**Есть и работает:** welcome (ru/pl/en, founder-voice), payment_succeeded/failed/
canceled (Stripe), weekly_digest (email+TG), team_invitation, gdpr_export,
bank_consent_expiring, privacy_alert; геймифицированный SetupProgressBar
(endowed-progress 40% + goal-gradient + награда «+14 дней», server-validated,
анти-абьюз — ADR-034); review-request SMS/email с 5★-гейтингом на Google;
visit-reminder (lapsed client) SMS/email; per-salon SMS-биллинг.

**Дыры (приоритет для следующей итерации):**

1. 🔴 **БАГ выручки: trial-ending письмо не уходит для implicit-trial.** Шаблон
   `trial_ending` привязан к Stripe `customer.subscription.trial_will_end`, но
   онбординг создаёт implicit-trial 14 дней БЕЗ карты и БЕЗ Stripe-подписки
   (`OnboardingPage.tsx:780`). Такие салоны никогда не генерят это событие →
   письма нет. Нет крона, сканирующего дедлайны триала
   (`salon_subscriptions.trial_ends_at`/`bonus_until`/`created_at+14d`).
   **Фикс:** новый edge-function + pg_cron (по паттерну rendezvous-token),
   сканирует дедлайны, шлёт `trial_ending` за 3/1 дн + trial-expired notice.
   Чувствительно (биллинг/миграция) — тесты + проверка на staging.
2. 🔴 Нет activation-drip: «добавь первый визит» только in-app (SetupProgressBar),
   нет email-напоминания о незавершённой настройке и о окне награды +14 дней.
3. 🔴 Нет win-back/re-engagement (только один cancel-email; ничего для
   протухших implicit-trial и неактивных владельцев).
4. 🔴 Нет SMS-напоминания клиенту о предстоящем визите (есть только post-visit
   review + lapsed-client).
5. 🟡 Дуннинг single-shot (только один `payment_failed`, без эскалации day1/3/final).
6. 🟡 Большинство lifecycle-писем RU-only (pl/en фоллбэк на русский) — критично
   для PL-рынка.

**Что усилить по скиллам (после фикса дыр):** welcome-tone уже хорош (founder-
voice); SetupProgressBar уже применяет goal-gradient/Zeigarnik/endowed-progress —
добавить email-подкрепление окна награды; trial-ending как часть launch/emails
последовательности.

### Phase 6 — Programmatic SEO + контент + PL-локаль

- **PL-локаль (главный рычаг):** Astro i18n SSR-маршруты `/pl/`, перевод ключевых
  страниц (index, pricing, features), корректные hreflang (сейчас все 4 указывают
  на один URL — это надо чинить ВМЕСТЕ с появлением реальных /pl/ страниц).
- Comparison/use-case страницы под ключи (comparison-статьи дают ~33% AI-цитат):
  «Finkley и Booksy», «учёт для салона красоты», по нишам (маникюр, барбершоп).
- Новые блог-статьи под programmatic-seo, оптимизированные под AI-цитирование
  (статистика с источниками, FAQ-блоки, BlogPosting schema уже автоматом).

## Известные ограничения / на согласование владельцу

- **hreflang сломан** (ru/en/pl/x-default → один URL). Чинить вместе с PL SSR.
- **manifest.json** только SVG-иконки — нет PNG 192/512 для PWA/Lighthouse
  (нужны бинарные ассеты — отдельно).
- **Отзывы на главной — плейсхолдеры** (Magda K. и т.д.). НЕ размечены Review/
  AggregateRating schema (правила Google). Заменить реальными после первых клиентов.
