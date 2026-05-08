# ADR-003: Monorepo + pnpm workspaces, без Turborepo/Nx

## Статус

`Accepted` · 2026-05-05

## Контекст

Решали как организовать репозиторий: SPA (`apps/web`) + landing (`apps/landing`) +
будущие сервисы (`supabase/functions`, ADR-эксперты, скрипты). Варианты:

1. **Один репо без monorepo** — всё в одном `package.json`, ванильный
2. **Monorepo + pnpm workspaces** — два sub-package, общие deps в корне
3. **Monorepo + Turborepo** — кэширование билдов, орчестрация
4. **Monorepo + Nx** — то же что Turborepo, но больше boilerplate

## Решение

**Вариант 2 — pnpm workspaces без Turborepo/Nx.**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
```

Корневой `package.json` определяет общие зависимости, скрипты делегируют через
`pnpm --filter <pkg> <cmd>`.

## Почему не Turborepo/Nx

- **Только 2 пакета** (web + landing) — оркестрация не нужна, билд-граф тривиальный
- **Edge functions** — не npm-package, отдельный bundle через Supabase CLI
- **Кэширование билдов** — на CI не нужно (фул-rebuild укладывается в 1 минуту)
- **Меньше boilerplate** — нет лишних config-файлов и terminology

Если когда-то добавим 5+ пакетов с зависимостями между ними — Turborepo
(сделать миграцию = добавить `turbo.json` без слома существующих скриптов).

## Почему pnpm, не npm/yarn

- **Быстрее устанавливает** через hard-link strategy (важно для CI)
- **Строже к peer deps** — поймает кривые версии раньше
- **Workspaces native** с дня 1 без shenanigans
- Корпоративный стандарт у Vercel/Vite/etc — много примеров

## Последствия

- Все скрипты вызываются через `pnpm --filter <name> <cmd>` или короткие
  алиасы в корневом `package.json` (`pnpm dev`, `pnpm build`, etc.)
- CI использует `pnpm/action-setup@v4`
- `.npmrc` с `node-linker=hoisted` — нет, оставляем дефолт isolated
- Edge functions не в workspace — деплоятся через `supabase functions deploy`
  отдельно (см. `scripts/deploy-edge-function.mjs`)
