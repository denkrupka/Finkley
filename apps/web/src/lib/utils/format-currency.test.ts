import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n'

import { formatCurrency, getCurrencyLocale } from './format-currency'

describe('formatCurrency', () => {
  it('форматирует копейки в PLN с русской локалью', () => {
    const result = formatCurrency(10000, 'PLN', 'ru')
    // В разных рантаймах форматирование PLN может отличаться (zł / PLN)
    // Проверяем основную часть: число + символ
    expect(result).toMatch(/100[,.]00/)
    expect(result.toLowerCase()).toMatch(/zł|pln/)
  })

  it('обрабатывает ноль', () => {
    const result = formatCurrency(0, 'EUR', 'ru')
    expect(result).toMatch(/0[,.]00/)
  })

  it('форматирует EUR', () => {
    const result = formatCurrency(1500, 'EUR', 'ru')
    expect(result).toMatch(/15[,.]00/)
    expect(result).toContain('€')
  })

  it('обрабатывает большие числа без научной нотации', () => {
    const result = formatCurrency(99_999_99, 'PLN', 'ru')
    expect(result).toMatch(/99[\s\u00A0]?999[,.]99/)
  })

  it('обрабатывает отрицательные суммы (убыток)', () => {
    const result = formatCurrency(-5000, 'PLN', 'ru')
    expect(result).toContain('-')
    expect(result).toMatch(/50[,.]00/)
  })
})

describe('getCurrencyLocale (auto-locale из i18n)', () => {
  const originalLang = i18n.language

  afterEach(() => {
    void i18n.changeLanguage(originalLang ?? 'ru')
  })

  it('ru → ru-RU', () => {
    void i18n.changeLanguage('ru')
    expect(getCurrencyLocale()).toBe('ru-RU')
  })

  it('pl → pl-PL', () => {
    void i18n.changeLanguage('pl')
    expect(getCurrencyLocale()).toBe('pl-PL')
  })

  it('en → en-US', () => {
    void i18n.changeLanguage('en')
    expect(getCurrencyLocale()).toBe('en-US')
  })

  it('en-GB / pl-PL (с регионом) — берётся базовый язык', () => {
    void i18n.changeLanguage('en-GB')
    expect(getCurrencyLocale()).toBe('en-US')
  })

  it('formatCurrency без явного locale использует текущий i18n', () => {
    void i18n.changeLanguage('en')
    const result = formatCurrency(10000, 'USD')
    // en-US: $100.00
    expect(result).toMatch(/\$100\.00/)
  })
})
