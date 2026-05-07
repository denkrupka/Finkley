/**
 * Минимальный CSV-парсер. Работает с RFC 4180 (поля в кавычках, escape ""),
 * автоматически детектит разделитель (`,` или `;`).
 *
 * Не зависим от внешних библиотек — добавление PapaParse требовало бы ADR
 * (см. CLAUDE.md), а для импорта visits-выгрузок Booksy/Fresha/Treatwell
 * хватает базового RFC 4180. Если попадётся CSV с подвохом — добавим тогда.
 */

export type CsvParseResult = {
  headers: string[]
  rows: string[][]
  delimiter: ',' | ';'
}

function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis = (firstLine.match(/;/g) ?? []).length
  return semis > commas ? ';' : ','
}

export function parseCsv(text: string): CsvParseResult {
  // Убираем BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        field += c
      }
    } else {
      if (c === '"' && field === '') {
        inQuotes = true
      } else if (c === delimiter) {
        row.push(field)
        field = ''
      } else if (c === '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      } else if (c === '\r') {
        // skip
      } else {
        field += c
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Удаляем пустые строки в конце (типичная проблема экспорта из Excel)
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.trim() === '')) {
    rows.pop()
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim())
  return { headers, rows, delimiter }
}

/**
 * Парсит дату в форматах: ISO (yyyy-mm-dd / yyyy-mm-ddThh:mm), DD.MM.YYYY, DD/MM/YYYY.
 * Возвращает Date в UTC или null если не распознано.
 */
export function parseDateLoose(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  // ISO форматы — Date.parse справится
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed)
    return isNaN(d.getTime()) ? null : d
  }

  // DD.MM.YYYY или DD/MM/YYYY [HH:mm]
  const m = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/)
  if (m) {
    const [, dd, mm, yyyy, hh = '0', mi = '0'] = m
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi)))
    return isNaN(d.getTime()) ? null : d
  }

  return null
}

/** Парсит сумму в любом из форматов: "1234.56", "1 234,56", "1,234.56", "1234". */
export function parseAmountLoose(value: string): number | null {
  const trimmed = value.trim().replace(/\s+/g, '')
  if (!trimmed) return null
  // Если есть и запятая и точка — последний разделитель считаем десятичным
  let normalized = trimmed
  const lastDot = normalized.lastIndexOf('.')
  const lastComma = normalized.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastDot > lastComma) normalized = normalized.replace(/,/g, '')
    else normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else if (lastComma >= 0) {
    normalized = normalized.replace(',', '.')
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/**
 * Стабильный хеш для дедупа CSV-строк. SHA-1 через WebCrypto. Используется
 * как visits.external_id вместе с source='csv_import' — повторный импорт
 * того же файла не создаст дубликаты благодаря unique-индексу.
 */
export async function hashRow(parts: (string | number | null)[]): Promise<string> {
  const text = parts.map((p) => (p == null ? '' : String(p))).join('|')
  const buf = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-1', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
