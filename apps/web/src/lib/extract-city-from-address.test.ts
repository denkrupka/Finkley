import { describe, expect, it } from 'vitest'

import { extractCityFromAddress } from './extract-city-from-address'

describe('extractCityFromAddress', () => {
  it('PL: индекс NN-NNN перед городом (кейс юзера 02.07)', () => {
    expect(extractCityFromAddress('Rybaki 1/u02, 61-884 Poznań, Польша')).toBe('Poznań')
  })

  it('PL: без индекса', () => {
    expect(extractCityFromAddress('Główna 5, Poznań, Polska')).toBe('Poznań')
  })

  it('DE: пятизначный индекс', () => {
    expect(extractCityFromAddress('Unter den Linden 1, 10117 Berlin, Deutschland')).toBe('Berlin')
  })

  it('NL: индекс с буквами (1012 AB)', () => {
    expect(extractCityFromAddress('Damrak 1, 1012 AB Amsterdam, Nederland')).toBe('Amsterdam')
  })

  it('CZ: индекс с пробелом (110 00) и город с цифрой', () => {
    expect(extractCityFromAddress('Václavské nám. 1, 110 00 Praha 1, Česko')).toBe('Praha 1')
  })

  it('LT: индекс с префиксом страны (LT-01103)', () => {
    expect(extractCityFromAddress('Gedimino pr. 9, LT-01103 Vilnius, Lietuva')).toBe('Vilnius')
  })

  it('короткий адрес «город, страна» → город', () => {
    expect(extractCityFromAddress('Poznań, Polska')).toBe('Poznań')
  })

  it('одна часть без запятых → null', () => {
    expect(extractCityFromAddress('Poznań')).toBeNull()
  })

  it('пустая строка → null', () => {
    expect(extractCityFromAddress('')).toBeNull()
  })

  it('предпоследняя часть = только индекс → null (города нет)', () => {
    expect(extractCityFromAddress('Główna 5, 61-884, Polska')).toBeNull()
  })

  it('лишние пробелы вокруг запятых не мешают', () => {
    expect(extractCityFromAddress('Rybaki 1 ,  61-884 Poznań , Polska')).toBe('Poznań')
  })
})
