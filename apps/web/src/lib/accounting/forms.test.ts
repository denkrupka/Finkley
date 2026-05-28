import { describe, expect, it } from 'vitest'

import { getLegalForm, getTaxForm, inferLegalFormFromName, LEGAL_FORMS } from './forms'

describe('getLegalForm', () => {
  it('возвращает LegalForm для существующего value', () => {
    const form = getLegalForm('jdg')
    expect(form).not.toBeNull()
    expect(form?.label).toContain('Jednoosobowa')
  })

  it('null/undefined/empty → null', () => {
    expect(getLegalForm(null)).toBeNull()
    expect(getLegalForm(undefined)).toBeNull()
    expect(getLegalForm('')).toBeNull()
  })

  it('неизвестный value → null', () => {
    expect(getLegalForm('not_a_form')).toBeNull()
  })

  it('возвращает Sp. z o.o.', () => {
    expect(getLegalForm('sp_zoo')?.value).toBe('sp_zoo')
  })
})

describe('getTaxForm', () => {
  it('jdg + skala → возвращает skala налоговую форму', () => {
    const form = getTaxForm('jdg', 'skala')
    expect(form?.value).toBe('skala')
    expect(form?.rates).toHaveLength(2)
  })

  it('jdg + ryczalt → возвращает 10 ставок', () => {
    const form = getTaxForm('jdg', 'ryczalt')
    expect(form?.rates).toHaveLength(10)
  })

  it('jdg + karta → rates пустой массив (индивидуальный аккорд)', () => {
    const form = getTaxForm('jdg', 'karta')
    expect(form?.rates).toEqual([])
  })

  it('неизвестная legal form → null', () => {
    expect(getTaxForm('unknown', 'skala')).toBeNull()
  })

  it('известная legal, неизвестная tax → null', () => {
    expect(getTaxForm('jdg', 'cit')).toBeNull()
  })

  it('null params → null', () => {
    expect(getTaxForm(null, null)).toBeNull()
    expect(getTaxForm('jdg', null)).toBeNull()
    expect(getTaxForm(null, 'skala')).toBeNull()
  })

  it('sp_zoo + cit → 9% и 19% ставки', () => {
    const form = getTaxForm('sp_zoo', 'cit')
    expect(form?.rates.map((r) => r.value)).toEqual([9, 19])
  })
})

describe('inferLegalFormFromName', () => {
  it('Sp. z o.o. — каноническое написание', () => {
    expect(inferLegalFormFromName('Salon ABC Sp. z o.o.')).toBe('sp_zoo')
    expect(inferLegalFormFromName('ABC sp. z o.o.')).toBe('sp_zoo')
  })

  it('Sp. z o.o. — без точек/пробелов', () => {
    expect(inferLegalFormFromName('ABC sp z oo')).toBe('sp_zoo')
  })

  it('Sp. z o.o. — длинная форма', () => {
    expect(inferLegalFormFromName('ABC spółka z ograniczoną odpowiedzialnością')).toBe('sp_zoo')
  })

  it('S.A. — Spółka akcyjna', () => {
    expect(inferLegalFormFromName('Bank S.A.')).toBe('s_a')
    expect(inferLegalFormFromName('ABC spółka akcyjna')).toBe('s_a')
  })

  it('Sp. j. — Spółka jawna', () => {
    expect(inferLegalFormFromName('ABC sp. j.')).toBe('sp_jawna')
    expect(inferLegalFormFromName('ABC spółka jawna')).toBe('sp_jawna')
  })

  it('Sp. k. — Spółka komandytowa', () => {
    expect(inferLegalFormFromName('ABC sp.k.')).toBe('sp_komandytowa')
    expect(inferLegalFormFromName('ABC spółka komandytowa')).toBe('sp_komandytowa')
  })

  it('Fundacja', () => {
    expect(inferLegalFormFromName('Fundacja Pomocy')).toBe('fundacja')
  })

  it('обычное название без маркеров → null (значит JDG/неизвестно)', () => {
    expect(inferLegalFormFromName('Salon Beauty')).toBeNull()
    expect(inferLegalFormFromName('Anna Kowalska')).toBeNull()
  })

  it('null/undefined/empty → null', () => {
    expect(inferLegalFormFromName(null)).toBeNull()
    expect(inferLegalFormFromName(undefined)).toBeNull()
    expect(inferLegalFormFromName('')).toBeNull()
  })

  it('case-insensitive', () => {
    expect(inferLegalFormFromName('SALON ABC SP. Z O.O.')).toBe('sp_zoo')
    expect(inferLegalFormFromName('SALON ABC sP. z O.o.')).toBe('sp_zoo')
  })
})

describe('LEGAL_FORMS data integrity', () => {
  it('все value уникальны', () => {
    const values = LEGAL_FORMS.map((f) => f.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('все формы имеют непустой label', () => {
    for (const form of LEGAL_FORMS) {
      expect(form.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('внутри каждой формы — уникальные tax_form values', () => {
    for (const form of LEGAL_FORMS) {
      const taxValues = form.tax_forms.map((tf) => tf.value)
      expect(new Set(taxValues).size).toBe(taxValues.length)
    }
  })
})
