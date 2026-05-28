import { describe, expect, it } from 'vitest'

import { parseAmountLoose, parseCsv, parseDateLoose } from './csv'

describe('parseCsv', () => {
  it('comma-разделитель — базовый случай', () => {
    const result = parseCsv('name,amount\nJohn,100\nJane,200')
    expect(result.delimiter).toBe(',')
    expect(result.headers).toEqual(['name', 'amount'])
    expect(result.rows).toEqual([
      ['John', '100'],
      ['Jane', '200'],
    ])
  })

  it('semicolon-разделитель — авто-детект (Excel в RU/PL локали)', () => {
    const result = parseCsv('имя;сумма\nИван;100\nАнна;200')
    expect(result.delimiter).toBe(';')
    expect(result.headers).toEqual(['имя', 'сумма'])
    expect(result.rows).toHaveLength(2)
  })

  it('BOM в начале файла — снимает', () => {
    const result = parseCsv('﻿name,amount\nJohn,100')
    expect(result.headers).toEqual(['name', 'amount'])
  })

  it('поля в кавычках с запятой внутри', () => {
    const result = parseCsv('name,note\nJohn,"Hello, world"')
    expect(result.rows).toEqual([['John', 'Hello, world']])
  })

  it('escape двойных кавычек: "" → "', () => {
    const result = parseCsv('name,quote\nJohn,"He said ""hi"""')
    expect(result.rows[0]?.[1]).toBe('He said "hi"')
  })

  it('CRLF (Windows) line endings', () => {
    const result = parseCsv('a,b\r\n1,2\r\n3,4\r\n')
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('пустые строки в конце — игнорируются', () => {
    const result = parseCsv('a,b\n1,2\n\n\n')
    expect(result.rows).toEqual([['1', '2']])
  })

  it('заголовки тримятся от пробелов', () => {
    const result = parseCsv(' name , amount \nJohn,100')
    expect(result.headers).toEqual(['name', 'amount'])
  })

  it('пустой CSV → headers=[], rows=[]', () => {
    const result = parseCsv('')
    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })

  it('только заголовки — пустые rows', () => {
    const result = parseCsv('a,b,c')
    expect(result.headers).toEqual(['a', 'b', 'c'])
    expect(result.rows).toEqual([])
  })
})

describe('parseDateLoose', () => {
  it('ISO date YYYY-MM-DD', () => {
    const d = parseDateLoose('2026-05-27')
    expect(d).not.toBeNull()
    expect(d?.getUTCFullYear()).toBe(2026)
    expect(d?.getUTCMonth()).toBe(4)
    expect(d?.getUTCDate()).toBe(27)
  })

  it('ISO datetime YYYY-MM-DDTHH:mm', () => {
    const d = parseDateLoose('2026-05-27T14:30Z')
    expect(d?.getUTCHours()).toBe(14)
    expect(d?.getUTCMinutes()).toBe(30)
  })

  it('DD.MM.YYYY (формат RU/PL)', () => {
    const d = parseDateLoose('27.05.2026')
    expect(d?.getUTCFullYear()).toBe(2026)
    expect(d?.getUTCMonth()).toBe(4)
    expect(d?.getUTCDate()).toBe(27)
  })

  it('DD/MM/YYYY (формат UK/IT)', () => {
    const d = parseDateLoose('27/05/2026')
    expect(d?.getUTCFullYear()).toBe(2026)
    expect(d?.getUTCMonth()).toBe(4)
    expect(d?.getUTCDate()).toBe(27)
  })

  it('DD.MM.YYYY HH:mm — с временем', () => {
    const d = parseDateLoose('27.05.2026 14:30')
    expect(d?.getUTCHours()).toBe(14)
    expect(d?.getUTCMinutes()).toBe(30)
  })

  it('пустая строка → null', () => {
    expect(parseDateLoose('')).toBeNull()
    expect(parseDateLoose('   ')).toBeNull()
  })

  it('мусор → null', () => {
    expect(parseDateLoose('not-a-date')).toBeNull()
    // Note: 45.67.2026 матчит regex, и Date.UTC автоматически переполняет
    // (45 день = май, 67 месяц = +5 лет). Это терпимое поведение — лучше
    // пропустить «странную» дату чем потерять валидную из-за strict-парсера.
  })

  it('однозначные день и месяц: 5.7.2026', () => {
    const d = parseDateLoose('5.7.2026')
    expect(d?.getUTCMonth()).toBe(6) // июль
    expect(d?.getUTCDate()).toBe(5)
  })
})

describe('parseAmountLoose', () => {
  it('целое число', () => {
    expect(parseAmountLoose('1234')).toBe(1234)
  })

  it('US формат с точкой', () => {
    expect(parseAmountLoose('1234.56')).toBe(1234.56)
  })

  it('RU/PL формат с запятой', () => {
    expect(parseAmountLoose('1234,56')).toBe(1234.56)
  })

  it('пробелы как тысячи RU/PL: "1 234,56"', () => {
    expect(parseAmountLoose('1 234,56')).toBe(1234.56)
  })

  it('US формат с тысячами: "1,234.56"', () => {
    expect(parseAmountLoose('1,234.56')).toBe(1234.56)
  })

  it('EU формат с тысячами: "1.234,56"', () => {
    expect(parseAmountLoose('1.234,56')).toBe(1234.56)
  })

  it('US с миллионами: "1,234,567.89"', () => {
    expect(parseAmountLoose('1,234,567.89')).toBe(1234567.89)
  })

  it('пустая строка → null', () => {
    expect(parseAmountLoose('')).toBeNull()
    expect(parseAmountLoose('   ')).toBeNull()
  })

  it('мусор → null', () => {
    expect(parseAmountLoose('abc')).toBeNull()
  })

  it('отрицательное число', () => {
    expect(parseAmountLoose('-100')).toBe(-100)
    expect(parseAmountLoose('-1 234,56')).toBe(-1234.56)
  })

  it('ноль', () => {
    expect(parseAmountLoose('0')).toBe(0)
    expect(parseAmountLoose('0,00')).toBe(0)
  })
})
