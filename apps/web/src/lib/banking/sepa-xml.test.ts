import { describe, expect, it } from 'vitest'

import { buildSepaXml, type SepaInput } from './sepa-xml'

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

describe('buildSepaXml', () => {
  it('генерит валидный pain.001.001.03 XML', () => {
    const xml = buildSepaXml(BASE_INPUT)
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03')
    expect(xml).toContain('<CstmrCdtTrfInitn>')
    expect(xml).toContain('<NbOfTxs>1</NbOfTxs>')
    expect(xml).toContain('<CtrlSum>123.45</CtrlSum>')
    expect(xml).toContain('PL61109010140000071219812874')
    expect(xml).toContain('PL27114020040000300201355387')
    expect(xml).toContain('<InstdAmt Ccy="PLN">123.45</InstdAmt>')
    expect(xml).toContain('Faktura FV/2026/05/123')
  })

  it('CtrlSum суммирует amounts корректно', () => {
    const xml = buildSepaXml({
      ...BASE_INPUT,
      payments: [
        { ...BASE_INPUT.payments[0]!, endToEndId: 'A', amountCents: 10000 },
        { ...BASE_INPUT.payments[0]!, endToEndId: 'B', amountCents: 25055 },
      ],
    })
    expect(xml).toContain('<NbOfTxs>2</NbOfTxs>')
    expect(xml).toContain('<CtrlSum>350.55</CtrlSum>')
  })

  it('XML-escape специальных символов в именах', () => {
    const xml = buildSepaXml({
      ...BASE_INPUT,
      debtorName: 'Salon "Beauty" & Co',
      payments: [{ ...BASE_INPUT.payments[0]!, creditorName: 'Vendor <test>' }],
    })
    expect(xml).toContain('Salon &quot;Beauty&quot; &amp; Co')
    expect(xml).toContain('Vendor &lt;test&gt;')
  })

  it('группирует payments по валюте в разные PmtInf блоки', () => {
    const xml = buildSepaXml({
      ...BASE_INPUT,
      payments: [
        { ...BASE_INPUT.payments[0]!, endToEndId: 'A', currency: 'PLN' },
        { ...BASE_INPUT.payments[0]!, endToEndId: 'B', currency: 'EUR' },
      ],
    })
    // Должно быть два PmtInf — по одному на валюту
    const pmtInfCount = (xml.match(/<PmtInf>/g) ?? []).length
    expect(pmtInfCount).toBe(2)
    expect(xml).toContain('<InstdAmt Ccy="PLN">')
    expect(xml).toContain('<InstdAmt Ccy="EUR">')
  })

  it('endToEndId режется до 35 символов', () => {
    const longId = 'A'.repeat(50)
    const xml = buildSepaXml({
      ...BASE_INPUT,
      payments: [{ ...BASE_INPUT.payments[0]!, endToEndId: longId }],
    })
    // Не должен быть >35 в EndToEndId
    const match = xml.match(/<EndToEndId>([^<]+)<\/EndToEndId>/)
    expect(match).not.toBeNull()
    expect(match![1]!.length).toBeLessThanOrEqual(35)
  })

  it('бросает на пустом payments', () => {
    expect(() => buildSepaXml({ ...BASE_INPUT, payments: [] })).toThrow()
  })

  it('бросает на отсутствующем debtorIban', () => {
    expect(() => buildSepaXml({ ...BASE_INPUT, debtorIban: '' })).toThrow()
  })

  it('бросает на отсутствующем creditorIban', () => {
    expect(() =>
      buildSepaXml({
        ...BASE_INPUT,
        payments: [{ ...BASE_INPUT.payments[0]!, creditorIban: '' }],
      }),
    ).toThrow()
  })

  it('опц BIC добавляется в DbtrAgt', () => {
    const xml = buildSepaXml({ ...BASE_INPUT, debtorBic: 'WBKPPLPP' })
    expect(xml).toContain('<BIC>WBKPPLPP</BIC>')
  })
})
