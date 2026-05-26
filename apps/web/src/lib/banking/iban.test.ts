import { describe, expect, it } from 'vitest'

import { formatIbanForDisplay, ibanCountry, isIbanValid, normalizeIban } from './iban'

describe('normalizeIban', () => {
  it('убирает пробелы и upper-case', () => {
    expect(normalizeIban('pl61 1090 1014 0000 0712 1981 2874')).toBe('PL61109010140000071219812874')
    expect(normalizeIban('  PL61  ')).toBe('PL61')
  })

  it('null/undefined/пусто → пустая строка', () => {
    expect(normalizeIban(null)).toBe('')
    expect(normalizeIban(undefined)).toBe('')
    expect(normalizeIban('')).toBe('')
  })
})

describe('formatIbanForDisplay', () => {
  it('группирует по 4 символа', () => {
    expect(formatIbanForDisplay('PL61109010140000071219812874')).toBe(
      'PL61 1090 1014 0000 0712 1981 2874',
    )
  })

  it('пустые значения → пустая строка', () => {
    expect(formatIbanForDisplay(null)).toBe('')
    expect(formatIbanForDisplay('')).toBe('')
  })

  it('идемпотентность: уже отформатированный остаётся таким же', () => {
    const formatted = 'PL61 1090 1014 0000 0712 1981 2874'
    expect(formatIbanForDisplay(formatted)).toBe(formatted)
  })
})

describe('isIbanValid (ISO 13616 mod-97)', () => {
  it('валидные PL IBAN (из публичных банк-документов)', () => {
    // Пример из Wikipedia + ЦБ PL
    expect(isIbanValid('PL61109010140000071219812874')).toBe(true)
    expect(isIbanValid('PL 61 1090 1014 0000 0712 1981 2874')).toBe(true)
  })

  it('валидные не-PL EU IBAN', () => {
    expect(isIbanValid('DE89370400440532013000')).toBe(true) // Wikipedia пример DE
    expect(isIbanValid('GB82WEST12345698765432')).toBe(true) // Wikipedia пример UK
    expect(isIbanValid('FR1420041010050500013M02606')).toBe(true) // Wikipedia пример FR
  })

  it('неверная контрольная сумма → false', () => {
    // тот же PL IBAN с искажённым check-digit
    expect(isIbanValid('PL62109010140000071219812874')).toBe(false)
  })

  it('слишком короткий или длинный → false', () => {
    expect(isIbanValid('PL61')).toBe(false)
    expect(isIbanValid('PL' + '1'.repeat(40))).toBe(false)
  })

  it('null/пусто → false', () => {
    expect(isIbanValid(null)).toBe(false)
    expect(isIbanValid('')).toBe(false)
    expect(isIbanValid(undefined)).toBe(false)
  })

  it('неверный формат (lowercase letters в BBAN) → нормализуется и валидируется', () => {
    // normalizeIban уже делает upper-case, поэтому валиден
    expect(isIbanValid('pl61109010140000071219812874')).toBe(true)
  })
})

describe('ibanCountry', () => {
  it('возвращает 2-буквенный код страны', () => {
    expect(ibanCountry('PL61109010140000071219812874')).toBe('PL')
    expect(ibanCountry('DE89370400440532013000')).toBe('DE')
    expect(ibanCountry('pl61 1090')).toBe('PL') // normalize uppercase'ит
  })

  it('null/слишком короткий → null', () => {
    expect(ibanCountry(null)).toBe(null)
    expect(ibanCountry('')).toBe(null)
    expect(ibanCountry('P')).toBe(null)
  })

  it('первые 2 символа не буквы → null', () => {
    expect(ibanCountry('1261109010')).toBe(null)
  })
})
