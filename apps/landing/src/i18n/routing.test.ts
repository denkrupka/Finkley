import { describe, expect, it } from 'vitest'

import { alternatesFor, localeFromPath, localizedPath, stripLocale } from './routing.ts'

describe('localizedPath', () => {
  it('RU — путь не меняется', () => {
    expect(localizedPath('/', 'ru')).toBe('/')
    expect(localizedPath('/pricing', 'ru')).toBe('/pricing')
    expect(localizedPath('/features/ai/', 'ru')).toBe('/features/ai/')
  })

  it('PL — префикс /pl', () => {
    expect(localizedPath('/', 'pl')).toBe('/pl/')
    expect(localizedPath('/pricing', 'pl')).toBe('/pl/pricing')
    expect(localizedPath('/features/ai/', 'pl')).toBe('/pl/features/ai/')
  })
})

describe('stripLocale', () => {
  it('убирает /pl', () => {
    expect(stripLocale('/pl/')).toBe('/')
    expect(stripLocale('/pl')).toBe('/')
    expect(stripLocale('/pl/pricing')).toBe('/pricing')
    expect(stripLocale('/pl/features/ai/')).toBe('/features/ai/')
  })

  it('RU-пути не трогает', () => {
    expect(stripLocale('/')).toBe('/')
    expect(stripLocale('/pricing')).toBe('/pricing')
  })

  it('round-trip localizedPath→stripLocale', () => {
    for (const p of ['/', '/pricing', '/features/ai/']) {
      expect(stripLocale(localizedPath(p, 'pl'))).toBe(p)
    }
  })
})

describe('localeFromPath', () => {
  it('определяет локаль', () => {
    expect(localeFromPath('/')).toBe('ru')
    expect(localeFromPath('/pricing')).toBe('ru')
    expect(localeFromPath('/pl/')).toBe('pl')
    expect(localeFromPath('/pl/pricing')).toBe('pl')
  })
})

describe('alternatesFor', () => {
  it('двуязычная страница → ru + pl + x-default, все разные URL', () => {
    const alts = alternatesFor('/pricing', ['ru', 'pl'])
    expect(alts).toEqual([
      { hreflang: 'ru', path: '/pricing' },
      { hreflang: 'pl', path: '/pl/pricing' },
      { hreflang: 'x-default', path: '/pricing' },
    ])
    // регрессия-гард против старого бага (все 4 hreflang → один URL):
    const ruPath = alts.find((a) => a.hreflang === 'ru')!.path
    const plPath = alts.find((a) => a.hreflang === 'pl')!.path
    expect(ruPath).not.toBe(plPath)
  })

  it('реципрокность: RU и PL версии отдают одинаковый набор альтернатив', () => {
    expect(alternatesFor('/pricing', ['ru', 'pl'])).toEqual(
      alternatesFor('/pl/pricing', ['ru', 'pl']),
    )
  })

  it('только-RU страница → без pl-альтернативы (не указываем на 404)', () => {
    const alts = alternatesFor('/features/ai/', ['ru'])
    expect(alts.some((a) => a.hreflang === 'pl')).toBe(false)
    expect(alts).toEqual([
      { hreflang: 'ru', path: '/features/ai/' },
      { hreflang: 'x-default', path: '/features/ai/' },
    ])
  })
})
