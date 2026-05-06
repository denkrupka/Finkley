# ADR-007: Дизайн-система — токены и Hi-fi прототип

## Статус

`Accepted` · 2026-05-06

## Контекст

В стадии 0–1 мы планировали идти на «голых» shadcn defaults и допиливать дизайн позже (это упоминалось в `docs/02_ARCHITECTURE.md`). Однако владелец построил Hi-fi прототип в Claude Design (`Design/project/Finkley Prototype.html` + сопутствующие `*.jsx`), который задаёт чёткую визуальную систему: палитру, типографику, скейл радиусов и теней, набор иконок, layout каждого ключевого экрана.

Без единого источника истины каждый новый компонент будет дрейфовать (магические #хексы в коде, разные шрифты по экранам, токены теней «на глаз»). Нужно зафиксировать систему до того, как мы начнём собирать реальные UI-задачи (TASK-09 и далее).

## Решение

**Источник истины для визуала — папка `Design/`. Прототип в Hi-fi HTML/JSX
описывает поведение и пиксели; `Design/project/tokens.jsx` — палитру,
шрифты, радиусы, тени.**

В коде токены живут в двух местах:

1. `apps/web/src/styles/globals.css` — CSS-переменные в HSL:
   - shadcn-aliases (`--primary`, `--background`, `--card`, `--destructive`, …) **смаплены** на Finkley-палитру, чтобы дефолтные shadcn-компоненты сразу читались как фирменные.
   - `--brand-*` — прямой доступ к фирменным цветам (`--brand-navy`, `--brand-teal`, `--brand-sage`, `--brand-red`, `--brand-yellow`, `--brand-gold` и их оттенки).

2. `apps/web/tailwind.config.ts` — Tailwind-обёртки:
   - `bg-primary`, `text-foreground` и т.п. — стандартные shadcn-токены, читают CSS-переменные.
   - `bg-brand-navy`, `text-brand-sage`, `border-brand-yellow-deep` — прямой доступ к фирменной палитре.
   - `font-display` (Plus Jakarta Sans), `font-sans` (Inter fallback), `font-mono` (JetBrains Mono для чисел).
   - `rounded-md` (10px), `rounded-lg` (14px карточки), `rounded-xl` (20px модалки) — скейл из прототипа.
   - `shadow-finsm`, `shadow-finmd`, `shadow-finlg`, `shadow-finxl` — тени из прототипа.

Прямые `style={{ background: '#1A1A2E' }}` или `font-family: '"Plus Jakarta Sans"'` в коде **запрещены** — всегда через токены.

**Прототип `Design/project/Finkley Prototype.html` НЕ копируем**: его внутренняя структура — inline-styles на чистом React. Мы воспроизводим визуальный результат на shadcn + Tailwind. Прототип — референс, не код.

## Палитра (для документации)

| Токен         | Hex       | HSL           | Использование                                        |
| ------------- | --------- | ------------- | ---------------------------------------------------- |
| navy          | `#1A1A2E` | `240 28% 14%` | primary buttons, активный sidebar, заголовки прибыли |
| navy-soft     | `#252543` | `240 30% 20%` | hover на navy                                        |
| navy-deep     | `#13132B` | `240 39% 12%` | press, тёмные градиенты                              |
| teal          | `#1E6B8A` | `197 64% 33%` | secondary buttons, ссылки, AI-блок                   |
| teal-soft     | `#E5F0F4` | `197 33% 93%` | подложка ссылочных pill'ов                           |
| teal-deep     | `#155571` | `199 70% 26%` | foreground на teal-soft                              |
| sage          | `#2E9E6B` | `153 55% 40%` | прибыль, рост, success                               |
| sage-soft     | `#E5F4ED` | `144 35% 93%` | подложка success-pill'ов                             |
| red           | `#C0392B` | `6 63% 46%`   | расходы, ошибки, destructive                         |
| red-soft      | `#F8E7E4` | `9 67% 93%`   | подложка warning                                     |
| yellow        | `#FFF9C4` | `54 100% 88%` | подсветка инпута суммы (визит/расход)                |
| yellow-deep   | `#F5E26B` | `53 87% 69%`  | бордер yellow-инпутов                                |
| gold          | `#C9A24B` | `41 51% 54%`  | Pro-план в sidebar                                   |
| bg            | `#FAFAF8` | `60 17% 98%`  | фон страницы                                         |
| card          | `#FFFFFF` | `0 0% 100%`   | карточки, поверхности                                |
| text          | `#1A1A1A` | `0 0% 10%`    | основной текст                                       |
| text-muted    | `#666666` | `0 0% 40%`    | подписи, лейблы                                      |
| text-faint    | `#9A9A9A` | `0 0% 60%`    | ещё мягче (timestamps, hints)                        |
| border        | `#ECECE7` | `48 11% 91%`  | основные бордеры                                     |
| border-strong | `#DCDCD5` | `48 9% 84%`   | чуть контрастнее (dashed)                            |

## Типографика

- **Display / UI:** Plus Jakarta Sans (400/500/600/700/800)
- **Fallback:** Inter (на случай провального fetch шрифта)
- **Числа** (KPI, таблицы, инпуты сумм): JetBrains Mono с `tnum` + `lnum` через CSS-класс `.num`. Tabular figures чтобы цифры в колонках выравнивались.

`@fontsource/plus-jakarta-sans`, `@fontsource/inter`, `@fontsource/jetbrains-mono` — все импортированы в `apps/web/src/main.tsx`. Никаких внешних `<link href="fonts.googleapis.com">` — оффлайн-friendly и без third-party DNS.

## Радиусы и тени

- `rSm: 6px` — мелкие пилюли, иконочные кнопки
- `rMd: 10px` — кнопки, инпуты, мелкие карточки
- `rLg: 14px` — основные карточки дашборда
- `rXl: 20px` — модалки

Тени — четырёхуровневый скейл `shadow-finsm/md/lg/xl`. Каждый уровень — две тени (короткая + длинная) для глубины.

## Альтернативы

- **Только shadcn defaults, дизайн потом** — отвергнуто: владелец уже потратил время на Hi-fi прототип, который явно описывает фирменный стиль. Игнорировать его — значит делать работу дважды.
- **Hardcoded стили из прототипа** (inline-styles, скопированные пиксели) — отвергнуто: невозможно поддерживать. Tailwind+CSS-vars даёт one-source-of-truth и темизацию.
- **CSS-in-JS (Emotion / styled-components)** — отвергнуто: лишняя зависимость и runtime-cost; Tailwind из стека уже всё умеет.

## Последствия

### Положительные

- Один источник правды для всех UI-задач TASK-09+
- shadcn-компоненты по умолчанию читаются как Finkley без переписывания
- Перетюн палитры — одно место (`globals.css`)
- Числа выровнены тоном и tabular figures, как в прототипе

### Отрицательные

- Plus Jakarta Sans + JetBrains Mono = +~150KB шрифтов в бандле (используем subset latin+cyrillic из @fontsource → tree-shakable по weights, но всё равно вес)
- При обновлении прототипа в Design/ нужно вручную синхронизировать токены. Автоматизации нет.
- Иконки прототипа — кастомный stroke-set; в реальном проекте берём `lucide-react` (близкий стиль, но не пиксель-в-пиксель).

### Что мониторим

- Если бандл шрифтов > 200KB → подключить `&subset=latin,cyrillic-ext` фильтр или удалить лишние weights
- Если в Design/ появятся новые токены, не описанные здесь → обновить ADR в том же PR что и токены
- Если lucide-react не покрывает нужную иконку → завести `apps/web/src/components/ui/icons/` с кастомными SVG, повторяющими `Design/project/icons.jsx`

## Связь с другими решениями

- ADR-001 (Vite SPA) — стек на котором это всё крутится
- TASK-09, TASK-10, TASK-13, TASK-14 в `docs/04_BACKLOG.md` — первые UI-задачи, использующие токены
- `Design/README.md` — авторский гид от Claude Design «как читать прототип»
