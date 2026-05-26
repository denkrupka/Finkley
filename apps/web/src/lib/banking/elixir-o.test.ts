import { describe, expect, it } from 'vitest'

import { buildElixirO, isElixirOCompatible } from './elixir-o'
import type { SepaInput } from './sepa-xml'

const BASE_INPUT: SepaInput = {
  debtorName: 'Test Salon Sp. z o.o.',
  debtorIban: 'PL61109010140000071219812874',
  executionDate: '2026-05-27',
  payments: [
    {
      endToEndId: 'PAY-001',
      amountCents: 12345,
      currency: 'PLN',
      creditorName: 'Vendor One',
      creditorIban: 'PL27114020040000300201355387',
      remittance: 'Faktura FV/2026/05/123',
    },
  ],
}

describe('buildElixirO', () => {
  it('генерит одну строку на платёж с 14 полями', () => {
    const out = buildElixirO(BASE_INPUT)
    expect(out.endsWith('\r\n')).toBe(true)
    const lines = out.trimEnd().split('\r\n')
    expect(lines).toHaveLength(1)
    const fields = lines[0]!.split(',')
    expect(fields).toHaveLength(14)
  })

  it('первое поле = 110 (przelew krajowy)', () => {
    const out = buildElixirO(BASE_INPUT)
    expect(out.split(',')[0]).toBe('110')
  })

  it('второе поле = дата YYYYMMDD без дефисов', () => {
    const out = buildElixirO(BASE_INPUT)
    expect(out.split(',')[1]).toBe('20260527')
  })

  it('третье поле = сумма в groszach (integer без точки)', () => {
    const out = buildElixirO(BASE_INPUT)
    expect(out.split(',')[2]).toBe('12345')
  })

  it('NRB-поля без префикса PL (26 цифр)', () => {
    const out = buildElixirO(BASE_INPUT)
    const fields = out.split(',')
    expect(fields[4]).toBe('61109010140000071219812874')
    expect(fields[5]).toBe('27114020040000300201355387')
  })

  it('тексты обернуты в кавычки, escape " → \'', () => {
    const out = buildElixirO({
      ...BASE_INPUT,
      debtorName: 'Salon "Beauty"',
    })
    expect(out).toContain('"Salon \'Beauty\'"')
  })

  it('текст длиннее 35 символов разбивается на 4×35 через |', () => {
    const long = 'X'.repeat(70)
    const out = buildElixirO({
      ...BASE_INPUT,
      payments: [{ ...BASE_INPUT.payments[0]!, creditorName: long }],
    })
    expect(out).toContain(
      '"XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX|XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"',
    )
  })

  it('бросает на не-PLN валюте', () => {
    expect(() =>
      buildElixirO({
        ...BASE_INPUT,
        payments: [{ ...BASE_INPUT.payments[0]!, currency: 'EUR' }],
      }),
    ).toThrow(/PLN/)
  })

  it('бросает на не-PL IBAN дебитора', () => {
    expect(() => buildElixirO({ ...BASE_INPUT, debtorIban: 'DE89370400440532013000' })).toThrow(
      /польс/i,
    )
  })

  it('бросает на не-PL IBAN бенефициара', () => {
    expect(() =>
      buildElixirO({
        ...BASE_INPUT,
        payments: [{ ...BASE_INPUT.payments[0]!, creditorIban: 'DE89370400440532013000' }],
      }),
    ).toThrow(/польс/i)
  })

  it('пустые payments → throw', () => {
    expect(() => buildElixirO({ ...BASE_INPUT, payments: [] })).toThrow()
  })

  it('несколько платежей → несколько строк', () => {
    const out = buildElixirO({
      ...BASE_INPUT,
      payments: [
        { ...BASE_INPUT.payments[0]!, endToEndId: 'A' },
        { ...BASE_INPUT.payments[0]!, endToEndId: 'B', amountCents: 50000 },
      ],
    })
    expect(out.trimEnd().split('\r\n')).toHaveLength(2)
  })
})

describe('isElixirOCompatible', () => {
  const PL_PAYMENT = {
    endToEndId: 'A',
    amountCents: 100,
    currency: 'PLN',
    creditorName: 'X',
    creditorIban: 'PL27114020040000300201355387',
    remittance: 'x',
  }

  it('PL→PL в PLN → true', () => {
    expect(isElixirOCompatible(PL_PAYMENT, 'PL61109010140000071219812874')).toBe(true)
  })

  it('EUR → false', () => {
    expect(isElixirOCompatible({ ...PL_PAYMENT, currency: 'EUR' }, 'PL61...')).toBe(false)
  })

  it('DE дебитор → false', () => {
    expect(isElixirOCompatible(PL_PAYMENT, 'DE89370400440532013000')).toBe(false)
  })

  it('DE бенефициар → false', () => {
    expect(
      isElixirOCompatible(
        { ...PL_PAYMENT, creditorIban: 'DE89370400440532013000' },
        'PL61109010140000071219812874',
      ),
    ).toBe(false)
  })
})
