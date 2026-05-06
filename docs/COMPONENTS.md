# Components Catalog

Каталог UI-компонентов проекта. Что используем из shadcn/ui, как кастомизируем, какие свои домен-специфичные компоненты пишем.

## Принципы

1. **Сначала — shadcn/ui defaults.** Не кастомизируем, пока не появилась реальная боль.
2. **Один компонент — один файл.** PascalCase. `VisitForm.tsx`, не `visit-form.tsx`.
3. **Компонент не знает про API.** Данные приходят через props. API-вызовы — в hooks или родителе.
4. **TanStack Query для серверного состояния.** Не useState для данных из БД.
5. **Никакой логики в jsx.** Если в компоненте больше 200 строк — выносить.

## Базовые shadcn/ui компоненты, которые используем

Установка: `pnpm dlx shadcn@latest add <component>`

### Стадия 1 — нужны сразу

| Компонент        | Где используется                              |
| ---------------- | --------------------------------------------- |
| `button`         | Везде                                         |
| `input`          | Все формы                                     |
| `label`          | Все формы                                     |
| `form`           | Все формы (через React Hook Form)             |
| `card`           | Дашборд KPI, списки                           |
| `dialog`         | Модальные окна (desktop)                      |
| `drawer`         | Bottom sheet (mobile) для форм визита/расхода |
| `dropdown-menu`  | Меню в шапке, переключатель салонов           |
| `select`         | Select в формах                               |
| `combobox`       | Поиск услуги/клиента (стадия 2)               |
| `tabs`           | Settings, переключатели периода               |
| `toast` (sonner) | Уведомления успех/ошибка                      |
| `skeleton`       | Loading states                                |
| `alert`          | Inline-ошибки, баннеры триала                 |
| `badge`          | Теги, статусы                                 |
| `avatar`         | Юзер в шапке                                  |
| `separator`      | Визуальные разделители                        |
| `popover`        | Date picker, фильтры                          |
| `calendar`       | Date picker                                   |
| `tooltip`        | Подсказки                                     |
| `sheet`          | Drawer для деталей визита                     |
| `table`          | Список визитов/расходов (desktop)             |
| `radio-group`    | Выбор тарифа                                  |
| `switch`         | Тогглы в settings                             |
| `textarea`       | Комментарии                                   |
| `progress`       | Прогресс-бар онбординга                       |

### Стадия 2 — добавляем

| Компонент        | Где                           |
| ---------------- | ----------------------------- |
| `command` (cmdk) | Поиск услуг/клиентов          |
| `data-table`     | Реестр клиентов, payouts      |
| `chart`          | Recharts wrapper для дашборда |
| `accordion`      | FAQ на лендинге               |

## Кастомизация

### Тема

Файл `apps/web/src/index.css` — тут CSS variables shadcn. **Не меняем в стадии 1.** Defaults.

В стадии 2, когда появится дизайнер — поменяем:

- `--primary` → бренд-цвет
- `--accent` → emerald-600 для прибыли
- `--destructive` → rose-600 для ошибок
- `--radius` → возможно круглее или строже

### Шрифт

```css
/* apps/web/src/index.css */
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/inter/700.css';

:root {
  font-family:
    'Inter',
    system-ui,
    -apple-system,
    sans-serif;
  font-feature-settings: 'cv11', 'ss01'; /* Inter улучшения для цифр */
}
```

Цифры в KPI-карточках — `font-variant-numeric: tabular-nums` для одинаковой ширины.

## Доменные компоненты (наши)

`apps/web/src/components/domain/`

### `KPICard.tsx`

Карточка KPI на дашборде.

```tsx
interface KPICardProps {
  label: string
  value: number // в копейках/центах
  currency: string
  trend?: number // +/- % к прошлому периоду
  variant?: 'default' | 'profit' | 'loss'
}
```

Использует `formatCurrency` из `lib/utils/format-currency.ts`.

### `VisitForm.tsx`

Форма ввода/редактирования визита.

```tsx
interface VisitFormProps {
  salonId: string
  visit?: Visit // undefined = создание, заполнено = редактирование
  onSuccess?: (visit: Visit) => void
  onCancel?: () => void
}
```

Внутри:

- React Hook Form + Zod схема (`lib/validation/visit-schema.ts`)
- TanStack Query mutation
- Optimistic update
- Поля: дата, мастер (RadioGroup pills), услуга (Combobox), сумма, payment_method (RadioGroup pills), comment

### `ExpenseForm.tsx`

Аналогично VisitForm для расходов.

### `StaffSelector.tsx`

RadioGroup-pills для выбора мастера. Используется в форме визита и фильтрах.

### `ServiceCombobox.tsx`

Combobox с поиском услуги по имени, группированный по категориям.

### `PeriodSelector.tsx`

Tabs `[День][Неделя][Месяц]` + кнопка "Произвольный" → Calendar popover.

```tsx
interface PeriodSelectorProps {
  value: { start: Date; end: Date }
  onChange: (range: { start: Date; end: Date }) => void
  presets?: ('day' | 'week' | 'month' | 'custom')[]
}
```

### `EmptyState.tsx`

Универсальный empty state с иконкой, заголовком, подзаголовком и CTA.

```tsx
interface EmptyStateProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  cta?: { label: string; onClick: () => void }
}
```

### `SalonSwitcher.tsx`

Dropdown в шапке для переключения между салонами. Если 1 салон — просто его имя без dropdown.

### `BottomNav.tsx`

Mobile-only нижняя навигация: Дашборд / Визиты / "+" (FAB) / Расходы / Меню.

### `AppSidebar.tsx`

Desktop sidebar с навигацией.

### `OnboardingStepper.tsx`

Прогресс-бар + контейнер для шагов онбординга.

### `TrialBanner.tsx`

Жёлтый баннер сверху, когда триал заканчивается через ≤3 дня.

### `ReadOnlyBanner.tsx`

Красный баннер, когда подписка истекла → весь UI в режиме чтения.

## Layout-компоненты

### `AppLayout.tsx`

Основной layout для авторизованных страниц `/{salonId}/*`.

- Header (логотип + SalonSwitcher + аватар)
- Sidebar (desktop) / Drawer (mobile)
- Main content area
- BottomNav (mobile)

### `AuthLayout.tsx`

Layout для `/login`, `/signup`, `/forgot-password`. Центрированная форма на чистом фоне.

### `MarketingLayout.tsx` (если лендинг внутри SPA)

Лендинг-страницы. **Но мы выносим лендинг в Astro** — этот layout не нужен.

## Что НЕ делаем

- ❌ Не пишем свои Button, Input, Card. Используем shadcn.
- ❌ Не делаем "красивые" анимации. shadcn defaults достаточно.
- ❌ Не используем Material UI / Ant Design / Chakra. Только shadcn.
- ❌ Не пишем CSS-in-JS (styled-components, emotion). Только Tailwind.
- ❌ Не делаем компоненты "на будущее". YAGNI.

## Структура файлов

```
apps/web/src/components/
├── ui/                      # shadcn-генерируемые, НЕ редактируем без причины
│   ├── button.tsx
│   ├── input.tsx
│   ├── card.tsx
│   ├── ...
├── forms/                   # переиспользуемые поля форм
│   ├── form-field.tsx       # обёртка над shadcn form для RHF + Zod
│   ├── currency-input.tsx   # инпут для денег с маской
│   └── date-input.tsx
├── domain/                  # доменные компоненты
│   ├── KPICard.tsx
│   ├── VisitForm.tsx
│   ├── ExpenseForm.tsx
│   ├── StaffSelector.tsx
│   ├── ...
└── layout/
    ├── AppLayout.tsx
    ├── AuthLayout.tsx
    ├── AppSidebar.tsx
    └── BottomNav.tsx
```

## Тестирование компонентов

Не пишем юнит-тесты на простые компоненты (KPICard, EmptyState).

**Пишем тесты на:**

- Формы (VisitForm, ExpenseForm) — что валидация работает, что submit вызывает правильный mutation
- Сложную логику расчётов внутри компонента
- Hooks (`useAuth`, `useSalon`, `useVisits`)

**E2E через Playwright** — для основных флоу (см. `TESTING.md`).

## Доступность

- Все интерактивные элементы — `focus-visible` рамка (shadcn даёт)
- Контраст текста ≥ 4.5:1 (WCAG AA)
- ARIA labels на иконках без текста: `<button aria-label="Закрыть"><X /></button>`
- Все формы работают с клавиатуры (Tab, Enter, Esc)
- Skip-links не нужны (приложение SPA с фокусом)

## Производительность

- Lazy-loading тяжёлых компонентов через `React.lazy` (recharts, calendar)
- React.memo только когда профайлер показал реальную проблему
- `useMemo`/`useCallback` — не злоупотреблять, добавляют шума
