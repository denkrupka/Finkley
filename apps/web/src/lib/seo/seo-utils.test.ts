import { describe, expect, it } from 'vitest'

import { keywordDensity, slugify, titleContainsKeyword } from './seo-utils'

describe('keywordDensity (Cyrillic-aware)', () => {
  it('counts a Cyrillic keyword (ASCII \\b regression — was 0.0%)', () => {
    const text = 'Учёт прибыли салона — это просто. Учёт прибыли помогает видеть маржу.'
    const d = keywordDensity(text, 'учёт прибыли')
    expect(d).toBeGreaterThan(0)
  })

  it('counts inflected forms of the last word (учёт/учёта/учётом)', () => {
    const text = 'Без учёта расходов касса врёт. Учёт расходов и учётом расходов важны.'
    // 3 вхождения «учёт*» расход* / total слов
    const d = keywordDensity(text, 'учёт расходов')
    expect(d).toBeGreaterThan(0)
  })

  it('returns 0 for empty keyword or empty text', () => {
    expect(keywordDensity('', 'учёт')).toBe(0)
    expect(keywordDensity('какой-то текст', '')).toBe(0)
  })

  it('does not match across unrelated word boundaries', () => {
    const text = 'прибыльность бизнеса растёт'
    // 'прибыль' + до 3 окончаний → 'прибыльность' (ость = 4) НЕ матчится
    expect(keywordDensity(text, 'прибыль')).toBe(0)
  })
})

describe('titleContainsKeyword', () => {
  it('passes on exact substring', () => {
    expect(titleContainsKeyword('Учёт прибыли салона красоты', 'учёт прибыли')).toBe(true)
  })

  it('passes on inflected / reordered keyword (Russian morphology)', () => {
    expect(titleContainsKeyword('Куда девается прибыль салона', 'прибыль салона')).toBe(true)
    expect(titleContainsKeyword('Учёта прибыли в салоне', 'учёт прибыли')).toBe(true)
  })

  it('fails when keyword words are absent', () => {
    expect(titleContainsKeyword('Как нанять мастера', 'учёт прибыли')).toBe(false)
  })
})

describe('slugify (multi-language)', () => {
  it('transliterates Russian', () => {
    expect(slugify('Учёт прибыли салона')).toBe('uchyot-pribyli-salona')
  })

  it('transliterates Ukrainian-specific letters', () => {
    expect(slugify('Облік їжі є')).toMatch(/^[a-z0-9-]+$/)
    expect(slugify('Ґанок і їжа')).toContain('ganok')
  })

  it('folds Latin diacritics (de/cs/pl) to ascii', () => {
    expect(slugify('Über Café')).toBe('uber-cafe')
    expect(slugify('Příjem účet')).toMatch(/^[a-z0-9-]+$/)
    expect(slugify('Zysk właściciela')).toContain('wlasciciela')
  })

  it('produces only [a-z0-9-]', () => {
    expect(slugify('Großmäßig — €100!')).toMatch(/^[a-z0-9-]*$/)
  })
})
