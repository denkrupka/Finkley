import { describe, expect, it } from 'vitest'

import { buildMapping, guessField } from './csv-mapping'

describe('guessField', () => {
  it('распознаёт дату/время на разных языках', () => {
    expect(guessField('Date')).toBe('visit_at')
    expect(guessField('Дата визита')).toBe('visit_at')
    expect(guessField('Datum')).toBe('visit_at') // de
    expect(guessField('Uhrzeit')).toBe('visit_at') // de
    expect(guessField('Heure')).toBe('visit_at') // fr
    expect(guessField('Ora')).toBe('visit_at') // it
  })

  it('распознаёт сумму на разных языках', () => {
    expect(guessField('Price')).toBe('amount')
    expect(guessField('Preis')).toBe('amount') // de
    expect(guessField('Prix')).toBe('amount') // fr
    expect(guessField('Prezzo')).toBe('amount') // it
    expect(guessField('Сумма')).toBe('amount')
  })

  it('телефон vs клиент: не путает', () => {
    expect(guessField('Telefon des Kunden')).toBe('client_phone') // phone выигрывает
    expect(guessField('Kundenname')).toBe('client_name')
  })

  it('мастер vs клиент: staff не матчится как client', () => {
    expect(guessField('Mitarbeiter')).toBe('staff_name') // de
    expect(guessField('Praticien')).toBe('staff_name') // fr
    expect(guessField('Therapist')).toBe('staff_name')
    expect(guessField('Kunde')).toBe('client_name') // de
  })

  it('услуга/оплата/коммент', () => {
    expect(guessField('Behandlung')).toBe('service_name') // de
    expect(guessField('Bezahlt mit')).toBe('payment_method') // de
    expect(guessField('Notiz')).toBe('comment') // de
  })

  it('неизвестная колонка → skip', () => {
    expect(guessField('Booking ID')).toBe('skip')
    expect(guessField('xyz')).toBe('skip')
  })
})

describe('buildMapping', () => {
  it('детектит Treatwell EN-экспорт по шаблону', () => {
    const headers = ['Date', 'Time', 'Customer Name', 'Treatment', 'Therapist', 'Price', 'Paid by']
    const m = buildMapping(headers)
    expect(m[0]).toBe('visit_at')
    expect(m[2]).toBe('client_name')
    expect(m[3]).toBe('service_name')
    expect(m[4]).toBe('staff_name')
    expect(m[5]).toBe('amount')
    expect(m[6]).toBe('payment_method')
  })

  it('детектит Treatwell DE-экспзорт (немецкая локаль connect.treatwell.de)', () => {
    const headers = ['Datum', 'Uhrzeit', 'Kundenname', 'Behandlung', 'Mitarbeiter', 'Preis']
    const m = buildMapping(headers)
    expect(m[0]).toBe('visit_at')
    expect(m[2]).toBe('client_name')
    expect(m[3]).toBe('service_name')
    expect(m[4]).toBe('staff_name')
    expect(m[5]).toBe('amount')
  })

  it('неизвестный формат (<3 совпадений) → generic guessField по всем', () => {
    const headers = ['Когда', 'Клиент', 'Стоимость']
    const m = buildMapping(headers)
    expect(m[0]).toBe('visit_at')
    expect(m[1]).toBe('client_name')
    expect(m[2]).toBe('amount')
  })
})
