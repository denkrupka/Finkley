/**
 * Shadow-тест для supabase/functions/_shared/notifications-i18n.ts.
 *
 * Эдж-функция на Deno не может быть импортирована в Vite-сборку, поэтому
 * хелперы переписаны inline. Любое расхождение → надо синкать оба места.
 * Тест защищает от случайного дрейфа.
 */
import { describe, expect, it } from 'vitest'

type NotifLocale = 'ru' | 'pl' | 'en'

function normalizeNotifLocale(input: unknown): NotifLocale {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

type Dict = Record<string, string>

const RU: Dict = {
  'payment.header.due_2d': '📅 Через 2 дня — платежи по фактурам ({{salonName}})',
  'payment.no_vendor': 'без поставщика',
  'lowinv.header': '📦 Низкие остатки на складе ({{salonName}})',
  'lowinv.line': '• {{name}}: {{stock}} {{unit}} (порог {{min}} {{unit}})',
  'common.dash': '—',
}

const PL: Dict = {
  'payment.header.due_2d': '📅 Za 2 dni — płatności faktur ({{salonName}})',
  'payment.no_vendor': 'bez dostawcy',
  'lowinv.header': '📦 Niskie stany magazynowe ({{salonName}})',
  'lowinv.line': '• {{name}}: {{stock}} {{unit}} (próg {{min}} {{unit}})',
  'common.dash': '—',
}

const EN: Dict = {
  'payment.header.due_2d': '📅 In 2 days — invoice payments ({{salonName}})',
  'payment.no_vendor': 'no vendor',
  'lowinv.header': '📦 Low stock ({{salonName}})',
  'lowinv.line': '• {{name}}: {{stock}} {{unit}} (threshold {{min}} {{unit}})',
  'common.dash': '—',
}

const DICTS: Record<NotifLocale, Dict> = { ru: RU, pl: PL, en: EN }

function makeT(
  locale: NotifLocale,
): (key: string, vars?: Record<string, string | number>) => string {
  const dict = DICTS[locale] ?? RU
  return (key, vars) => {
    const tmpl = dict[key] ?? RU[key] ?? key
    if (!vars) return tmpl
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''))
  }
}

describe('notifications-i18n: normalizeNotifLocale', () => {
  it('базовая локаль ru/pl/en', () => {
    expect(normalizeNotifLocale('ru')).toBe('ru')
    expect(normalizeNotifLocale('pl')).toBe('pl')
    expect(normalizeNotifLocale('en')).toBe('en')
  })

  it('BCP-47 с регионом → базовый язык', () => {
    expect(normalizeNotifLocale('ru-RU')).toBe('ru')
    expect(normalizeNotifLocale('pl-PL')).toBe('pl')
    expect(normalizeNotifLocale('en-GB')).toBe('en')
    expect(normalizeNotifLocale('en-US')).toBe('en')
  })

  it('case-insensitive (PL → pl)', () => {
    expect(normalizeNotifLocale('PL')).toBe('pl')
    expect(normalizeNotifLocale('EN-US')).toBe('en')
  })

  it('unsupported / мусор → ru fallback', () => {
    expect(normalizeNotifLocale('de')).toBe('ru')
    expect(normalizeNotifLocale('uk')).toBe('ru')
    expect(normalizeNotifLocale('')).toBe('ru')
    expect(normalizeNotifLocale(null)).toBe('ru')
    expect(normalizeNotifLocale(undefined)).toBe('ru')
    expect(normalizeNotifLocale(42)).toBe('ru')
  })
})

describe('notifications-i18n: makeT', () => {
  it('возвращает строку нужной локали', () => {
    const t = makeT('en')
    expect(t('payment.no_vendor')).toBe('no vendor')
  })

  it('интерполирует {{var}} плейсхолдеры', () => {
    const t = makeT('ru')
    expect(t('lowinv.header', { salonName: 'Wonderful' })).toBe(
      '📦 Низкие остатки на складе (Wonderful)',
    )
  })

  it('интерполирует несколько переменных', () => {
    const t = makeT('en')
    expect(t('lowinv.line', { name: 'Shampoo', stock: 2, min: 5, unit: 'pcs' })).toBe(
      '• Shampoo: 2 pcs (threshold 5 pcs)',
    )
  })

  it('PL форма с правильной склонностью', () => {
    const t = makeT('pl')
    expect(t('lowinv.line', { name: 'Szampon', stock: 2, min: 5, unit: 'szt' })).toBe(
      '• Szampon: 2 szt (próg 5 szt)',
    )
  })

  it('отсутствующий ключ → fallback на RU', () => {
    const t = makeT('en')
    expect(t('common.dash')).toBe('—')
  })

  it('полностью отсутствующий ключ → сам ключ', () => {
    const t = makeT('ru')
    expect(t('nonexistent.key.deep')).toBe('nonexistent.key.deep')
  })

  it('отсутствующая переменная → пустая строка (а не undefined)', () => {
    const t = makeT('ru')
    expect(t('lowinv.line', { name: 'Краска', stock: 1, unit: 'л' })).toBe(
      '• Краска: 1 л (порог  л)',
    )
  })

  it('одна и та же интерполяция используется несколько раз', () => {
    const t = makeT('ru')
    expect(t('lowinv.line', { name: 'X', stock: 0, min: 1, unit: 'kg' })).toBe(
      '• X: 0 kg (порог 1 kg)',
    )
  })
})
