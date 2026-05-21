/**
 * i18n для серверных уведомлений (push / email / Telegram), которые шлют
 * payment-reminders, daily-notifications, generate-insights и пр.
 *
 * Отдельно от клиентского i18n (apps/web/src/i18n/locales) — Edge функции
 * на Deno не могут импортировать JSON оттуда, и нагрузка переводов тут
 * сильно меньше: ~50 строк, не 1700.
 *
 * Использование:
 *   const t = makeT(ownerLocale)
 *   const title = t('low_inventory.title', { salonName })
 */

export type NotifLocale = 'ru' | 'pl' | 'en'

export function normalizeNotifLocale(input: unknown): NotifLocale {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

type Dict = Record<string, string>

const RU: Dict = {
  // ── payment-reminders ─────────────────────────────────────────────────
  'payment.header.due_2d': '📅 Через 2 дня — платежи по фактурам ({{salonName}})',
  'payment.header.due_1d': '⏰ Завтра — платежи по фактурам ({{salonName}})',
  'payment.header.due_today': '🔔 Сегодня — платежи по фактурам ({{salonName}})',
  'payment.header.overdue': '⚠️ Просрочены платежи ({{salonName}})',
  'payment.line': '• {{amount}} — {{vendor}}{{invoiceSuffix}} (до {{dueDate}})',
  'payment.invoice_suffix': ' №{{number}}',
  'payment.no_vendor': 'без поставщика',
  'payment.email_footer':
    'Открой <a href="https://finkley.app/app/">Finkley → Платёжный календарь</a> чтобы пометить оплаченными.',
  // ── daily-notifications: low_inventory ────────────────────────────────
  'lowinv.header': '📦 Низкие остатки на складе ({{salonName}})',
  'lowinv.push_title': 'Низкие остатки — {{salonName}}',
  'lowinv.line': '• {{name}}: {{stock}} {{unit}} (порог {{min}} {{unit}})',
  'lowinv.email_footer':
    'Открой <a href="https://finkley.app/app/">Finkley → Склад</a> чтобы оприходовать закупку.',
  // ── daily-notifications: calendar_conflicts ───────────────────────────
  'conflict.header': '⚠️ Конфликты в календаре ({{salonName}})',
  'conflict.push_title': 'Конфликты в календаре — {{salonName}}',
  'conflict.line': '• {{staff}}: {{aTime}} «{{aService}}» × {{bTime}} «{{bService}}»',
  'conflict.line_html':
    '<strong>{{staff}}</strong>: {{aTime}} «{{aService}}» пересекается с {{bTime}} «{{bService}}»',
  'conflict.more': '…ещё {{count}}',
  'conflict.email_footer':
    'Открой <a href="https://finkley.app/app/">Finkley → Визиты</a> чтобы исправить.',
  // ── common ────────────────────────────────────────────────────────────
  'common.dash': '—',
}

const PL: Dict = {
  'payment.header.due_2d': '📅 Za 2 dni — płatności faktur ({{salonName}})',
  'payment.header.due_1d': '⏰ Jutro — płatności faktur ({{salonName}})',
  'payment.header.due_today': '🔔 Dziś — płatności faktur ({{salonName}})',
  'payment.header.overdue': '⚠️ Płatności przeterminowane ({{salonName}})',
  'payment.line': '• {{amount}} — {{vendor}}{{invoiceSuffix}} (do {{dueDate}})',
  'payment.invoice_suffix': ' nr {{number}}',
  'payment.no_vendor': 'bez dostawcy',
  'payment.email_footer':
    'Otwórz <a href="https://finkley.app/app/">Finkley → Kalendarz płatności</a> aby oznaczyć opłacone.',
  'lowinv.header': '📦 Niskie stany magazynowe ({{salonName}})',
  'lowinv.push_title': 'Niskie stany — {{salonName}}',
  'lowinv.line': '• {{name}}: {{stock}} {{unit}} (próg {{min}} {{unit}})',
  'lowinv.email_footer':
    'Otwórz <a href="https://finkley.app/app/">Finkley → Magazyn</a> aby uzupełnić zapas.',
  'conflict.header': '⚠️ Konflikty w kalendarzu ({{salonName}})',
  'conflict.push_title': 'Konflikty w kalendarzu — {{salonName}}',
  'conflict.line': '• {{staff}}: {{aTime}} „{{aService}}" × {{bTime}} „{{bService}}"',
  'conflict.line_html':
    '<strong>{{staff}}</strong>: {{aTime}} „{{aService}}" nakłada się na {{bTime}} „{{bService}}"',
  'conflict.more': '…jeszcze {{count}}',
  'conflict.email_footer':
    'Otwórz <a href="https://finkley.app/app/">Finkley → Wizyty</a> aby naprawić.',
  'common.dash': '—',
}

const EN: Dict = {
  'payment.header.due_2d': '📅 In 2 days — invoice payments ({{salonName}})',
  'payment.header.due_1d': '⏰ Tomorrow — invoice payments ({{salonName}})',
  'payment.header.due_today': '🔔 Today — invoice payments ({{salonName}})',
  'payment.header.overdue': '⚠️ Overdue payments ({{salonName}})',
  'payment.line': '• {{amount}} — {{vendor}}{{invoiceSuffix}} (due {{dueDate}})',
  'payment.invoice_suffix': ' #{{number}}',
  'payment.no_vendor': 'no vendor',
  'payment.email_footer':
    'Open <a href="https://finkley.app/app/">Finkley → Payment calendar</a> to mark them paid.',
  'lowinv.header': '📦 Low stock ({{salonName}})',
  'lowinv.push_title': 'Low stock — {{salonName}}',
  'lowinv.line': '• {{name}}: {{stock}} {{unit}} (threshold {{min}} {{unit}})',
  'lowinv.email_footer':
    'Open <a href="https://finkley.app/app/">Finkley → Inventory</a> to record the purchase.',
  'conflict.header': '⚠️ Calendar conflicts ({{salonName}})',
  'conflict.push_title': 'Calendar conflicts — {{salonName}}',
  'conflict.line': '• {{staff}}: {{aTime}} "{{aService}}" × {{bTime}} "{{bService}}"',
  'conflict.line_html':
    '<strong>{{staff}}</strong>: {{aTime}} "{{aService}}" overlaps with {{bTime}} "{{bService}}"',
  'conflict.more': '…and {{count}} more',
  'conflict.email_footer': 'Open <a href="https://finkley.app/app/">Finkley → Visits</a> to fix.',
  'common.dash': '—',
}

const DICTS: Record<NotifLocale, Dict> = { ru: RU, pl: PL, en: EN }

/**
 * Создаёт переводчик с зафиксированной локалью.
 * Поддерживает {{var}}-интерполяцию. Fallback на RU если ключа нет.
 */
export function makeT(
  locale: NotifLocale,
): (key: string, vars?: Record<string, string | number>) => string {
  const dict = DICTS[locale] ?? RU
  return (key, vars) => {
    const tmpl = dict[key] ?? RU[key] ?? key
    if (!vars) return tmpl
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''))
  }
}

/**
 * BCP-47 локаль для Intl.DateTimeFormat / NumberFormat по локали уведомления.
 */
export function bcp47(locale: NotifLocale): string {
  if (locale === 'pl') return 'pl-PL'
  if (locale === 'en') return 'en-US'
  return 'ru-RU'
}
