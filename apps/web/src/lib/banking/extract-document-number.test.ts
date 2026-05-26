import { describe, expect, it } from 'vitest'

import {
  extractDocumentNumber,
  findMatchingCounterpartyId,
  normalizeCounterpartyName,
} from './extract-document-number'

describe('extractDocumentNumber', () => {
  it('извлекает slash-токен с буквами (FV/...) и точками (P.KK.WDZ.P/...)', () => {
    expect(
      extractDocumentNumber('Wezwanie: P.KK.WDZ.P/04/26/5938424/0001 . Nr Klienta 5938424'),
    ).toBe('P.KK.WDZ.P/04/26/5938424/0001')
    expect(extractDocumentNumber('FV/2026/05/123 za usługi salonu')).toBe('FV/2026/05/123')
  })

  it('паттерн «Faktura nr ...»', () => {
    expect(extractDocumentNumber('Faktura nr 123/2026 od ZUS')).toBe('123/2026')
    expect(extractDocumentNumber('Nr dok. 456')).toBe('456')
  })

  it('dash-style INV-2026-001', () => {
    expect(extractDocumentNumber('Payment for INV-2026-001 services')).toBe('INV-2026-001')
  })

  it('чистая дата (без букв) НЕ матчится как slash-токен', () => {
    expect(extractDocumentNumber('Przelew z 01/02/2026')).toBe(null)
  })

  it('null/пусто → null', () => {
    expect(extractDocumentNumber(null)).toBe(null)
    expect(extractDocumentNumber('')).toBe(null)
    expect(extractDocumentNumber('   ')).toBe(null)
  })

  it('обычная строка без номера → null', () => {
    expect(extractDocumentNumber('Zwrot pożyczki')).toBe(null)
    expect(extractDocumentNumber('Telefonnyj perevod BLIK')).toBe(null)
  })

  it('режет хвостовые точки/запятые', () => {
    expect(extractDocumentNumber('Wezwanie: FV/2026/05/123. Nr Klienta')).toBe('FV/2026/05/123')
  })
})

describe('normalizeCounterpartyName', () => {
  it('режет PL правовые формы', () => {
    expect(normalizeCounterpartyName('Lidl Sp. z o.o.')).toBe('lidl')
    expect(normalizeCounterpartyName('myOrlen sp z oo')).toBe('myorlen')
    expect(normalizeCounterpartyName('Tesco S.A.')).toBe('tesco')
  })

  it('идентичные после нормализации', () => {
    expect(normalizeCounterpartyName('Lidl Sp. z o.o.')).toBe(
      normalizeCounterpartyName('LIDL spółka z o.o.'),
    )
  })

  it('пустая строка → пустая', () => {
    expect(normalizeCounterpartyName('')).toBe('')
    expect(normalizeCounterpartyName('   ')).toBe('')
  })
})

describe('findMatchingCounterpartyId', () => {
  const cps = [
    { id: 'cp1', name: 'Lidl Sp. z o.o.' },
    { id: 'cp2', name: 'myOrlen Sp. z o.o.' },
    { id: 'cp3', name: 'ZUS' },
  ]

  it('exact match через normalize', () => {
    expect(findMatchingCounterpartyId('Lidl Sp. z o.o.', cps)).toBe('cp1')
    expect(findMatchingCounterpartyId('myOrlen sp z oo', cps)).toBe('cp2')
  })

  it('substring fallback (bank-имя короче имени в справочнике)', () => {
    // "myOrlen" короче "myOrlen Sp. z o.o." после normalize
    expect(findMatchingCounterpartyId('myOrlen', cps)).toBe('cp2')
  })

  it('null/пустая → null', () => {
    expect(findMatchingCounterpartyId(null, cps)).toBe(null)
    expect(findMatchingCounterpartyId('', cps)).toBe(null)
    expect(findMatchingCounterpartyId(undefined, cps)).toBe(null)
  })

  it('нет совпадения → null', () => {
    expect(findMatchingCounterpartyId('Random Vendor LLC', cps)).toBe(null)
  })
})
