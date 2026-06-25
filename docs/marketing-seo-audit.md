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

### Phase 5 — Onboarding / Emails / SMS (in-product)

- Прочитать скиллы onboarding, emails, sms, launch, marketing-ideas.
- Аудит email-шаблонов (`supabase/functions/send-email`, digest, trial-reminder),
  онбординг-флоу (`apps/web/src/routes/onboarding/`), SMS/уведомлений.
- Применить: goal-gradient/IKEA в онбординг (уже есть SetupProgressBar — усилить),
  welcome/trial-ending/winback email-последовательности, SMS-комплаенс.

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
