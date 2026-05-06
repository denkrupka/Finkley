# ADR-008: Astro для лендинга

## Статус

`Accepted` · 2026-05-05

## Контекст

Лендинг — отдельная задача от SaaS-приложения:

- Нужен SEO (приложение SEO не нужно — за логином)
- Нужны быстрая загрузка и Lighthouse 95+
- Нужна возможность редактировать копирайт владельцем без знания React (в перспективе)
- Не нужна React-логика (никаких форм, кроме CTA на signup)

Варианты:

1. **Astro** — статический генератор с поддержкой компонентов (React, Vue, Svelte) или просто HTML/MD
2. **Простой статический HTML** в `apps/landing/`
3. **Часть SPA** — лендинг как route в Vite-приложении

## Решение

**Astro.**

Структура:

```
apps/landing/
├── src/
│   ├── pages/
│   │   ├── index.astro       # /
│   │   ├── pricing.astro     # /pricing
│   │   ├── privacy.astro     # /privacy
│   │   ├── terms.astro       # /terms
│   │   └── faq.astro         # /faq
│   ├── components/
│   │   ├── Hero.astro
│   │   ├── Features.astro
│   │   ├── Pricing.astro
│   │   └── Footer.astro
│   └── layouts/
│       └── Base.astro
└── astro.config.mjs
```

Билдится в `apps/landing/dist/`, в GitHub Actions деплой merge-ит с `apps/web/dist/`:

```bash
mkdir -p public
cp -r apps/landing/dist/* public/
mkdir -p public/app
cp -r apps/web/dist/* public/app/
```

И всё это публикуется на GitHub Pages в одну ветку gh-pages.

## Альтернативы

- **Простой HTML.** Отклонено: не масштабируется, сложно поддерживать (нет компонентов, нет shared layout). Достаточно для MVP, но Astro даёт всё то же + плюс будущая гибкость почти бесплатно.
- **Часть SPA.** Отклонено: плохой SEO (статический HTML на лендинге индексируется лучше), и initial bundle SPA загружается дольше (что плохо для конверсии лендинга).
- **Nextra / Docusaurus.** Отклонены: они для документации, не маркетинговых сайтов.

## Последствия

### Положительные

- Отличный SEO (статический HTML, мета-теги, OpenGraph)
- Lighthouse Performance ≥95 из коробки
- Astro components очень близки к HTML+JSX, низкая кривая обучения
- В перспективе можно перейти на Markdown файлы для блога / FAQ — владелец сможет править сам

### Отрицательные

- Ещё одна технология в стеке. **Митигация:** Astro прост, и используется только для лендинга — изоляция
- Билд лендинга = ещё один шаг в CI. **Митигация:** GitHub Actions параллелит

### Что мониторим

- Если копирайт лендинга нужно править часто и владелец не справляется — рассмотреть headless CMS (Sanity, Decap)
- Если SEO не нужен (мы 100% растём через рефералы и cold outreach) — упростить до простого HTML
