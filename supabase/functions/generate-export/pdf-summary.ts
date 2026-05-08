/**
 * Генерация PDF summary для GDPR-экспорта.
 *
 * Зачем: юзеру / аудитору удобно открыть один читаемый файл с агрегатами
 * вместо того чтобы суммировать CSV руками. Сами «сырые» данные — в CSV.
 *
 * Шрифт: грузим Roboto-Regular.ttf с jsdelivr при cold-start (cyrillic + latin).
 * Если CDN недоступен — fallback на встроенный Helvetica + транслит cyrillic.
 *
 * pdf-lib + fontkit достаточно для табличной верстки. Размер итогового PDF
 * с subsetting ~30–50KB.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'

const FONT_URL =
  'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Regular.ttf'
const FONT_BOLD_URL =
  'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Bold.ttf'

export interface SalonSummary {
  name: string
  currency: string
  country: string | null
  visitsCount: number
  revenueCents: number
  expensesCount: number
  expensesCents: number
  clientsCount: number
  staffCount: number
  servicesCount: number
  firstVisitAt: string | null
  lastVisitAt: string | null
}

export interface PdfSummaryInput {
  userEmail: string
  generatedAt: string
  salons: SalonSummary[]
}

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
}

function transliterate(s: string): string {
  return Array.from(s)
    .map((ch) => {
      const lower = ch.toLowerCase()
      const mapped = TRANSLIT[lower]
      if (mapped === undefined) return ch
      return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1)
    })
    .join('')
}

async function loadFont(url: string): Promise<Uint8Array | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

function formatMoney(cents: number, currency: string): string {
  const value = (cents / 100).toFixed(2)
  return `${value} ${currency}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

interface FontPair {
  regular: PDFFont
  bold: PDFFont
  /** Если true — шрифт не поддерживает cyrillic, тексты транслитерируем. */
  needsTranslit: boolean
}

function safeText(s: string, fonts: FontPair): string {
  return fonts.needsTranslit ? transliterate(s) : s
}

async function setupFonts(doc: PDFDocument): Promise<FontPair> {
  doc.registerFontkit(fontkit)
  const [regBytes, boldBytes] = await Promise.all([loadFont(FONT_URL), loadFont(FONT_BOLD_URL)])
  if (regBytes && boldBytes) {
    try {
      const regular = await doc.embedFont(regBytes, { subset: true })
      const bold = await doc.embedFont(boldBytes, { subset: true })
      return { regular, bold, needsTranslit: false }
    } catch (e) {
      console.warn('PDF font embed failed, falling back to Helvetica', e)
    }
  }
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  return { regular, bold, needsTranslit: true }
}

interface Cursor {
  page: PDFPage
  y: number
}

function newPage(doc: PDFDocument): Cursor {
  const page = doc.addPage([595, 842]) // A4 portrait
  return { page, y: 800 }
}

function ensureSpace(doc: PDFDocument, c: Cursor, needed: number): Cursor {
  if (c.y - needed < 60) return newPage(doc)
  return c
}

function drawLine(
  c: Cursor,
  text: string,
  fonts: FontPair,
  opts: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> } = {},
): Cursor {
  const size = opts.size ?? 11
  const font = opts.bold ? fonts.bold : fonts.regular
  c.page.drawText(safeText(text, fonts), {
    x: 50,
    y: c.y,
    size,
    font,
    color: opts.color ?? rgb(0.1, 0.1, 0.15),
  })
  return { page: c.page, y: c.y - size - 4 }
}

function drawKeyValue(c: Cursor, key: string, value: string, fonts: FontPair): Cursor {
  c.page.drawText(safeText(key, fonts), {
    x: 50,
    y: c.y,
    size: 10,
    font: fonts.regular,
    color: rgb(0.4, 0.4, 0.45),
  })
  c.page.drawText(safeText(value, fonts), {
    x: 230,
    y: c.y,
    size: 10,
    font: fonts.bold,
    color: rgb(0.1, 0.1, 0.15),
  })
  return { page: c.page, y: c.y - 16 }
}

export async function buildSummaryPdf(input: PdfSummaryInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Finkley Data Export Summary')
  doc.setAuthor('Finkley')
  doc.setSubject('GDPR Article 20 — Right to Data Portability')
  const fonts = await setupFonts(doc)

  let c = newPage(doc)

  // Заголовок
  c.page.drawText(safeText('Finkley · Data Export Summary', fonts), {
    x: 50,
    y: c.y,
    size: 20,
    font: fonts.bold,
    color: rgb(0.07, 0.12, 0.27),
  })
  c.y -= 28
  c = drawLine(c, 'GDPR Article 20 — Right to Data Portability', fonts, {
    size: 10,
    color: rgb(0.4, 0.4, 0.45),
  })
  c.y -= 10

  // Метаданные
  c = drawKeyValue(c, 'Account email:', input.userEmail || '—', fonts)
  c = drawKeyValue(c, 'Generated at (UTC):', input.generatedAt, fonts)
  c = drawKeyValue(c, 'Salons in this export:', String(input.salons.length), fonts)
  c.y -= 10

  // Тотал по всем салонам
  const totals = input.salons.reduce(
    (acc, s) => ({
      visits: acc.visits + s.visitsCount,
      expenses: acc.expenses + s.expensesCount,
      clients: acc.clients + s.clientsCount,
      staff: acc.staff + s.staffCount,
      services: acc.services + s.servicesCount,
    }),
    { visits: 0, expenses: 0, clients: 0, staff: 0, services: 0 },
  )

  c = ensureSpace(doc, c, 100)
  c = drawLine(c, 'Totals across all salons', fonts, { bold: true, size: 13 })
  c.y -= 4
  c = drawKeyValue(c, 'Visits:', String(totals.visits), fonts)
  c = drawKeyValue(c, 'Expenses:', String(totals.expenses), fonts)
  c = drawKeyValue(c, 'Clients:', String(totals.clients), fonts)
  c = drawKeyValue(c, 'Staff:', String(totals.staff), fonts)
  c = drawKeyValue(c, 'Services:', String(totals.services), fonts)
  c.y -= 12

  // По каждому салону
  for (const s of input.salons) {
    c = ensureSpace(doc, c, 180)
    c = drawLine(c, `Salon: ${s.name}`, fonts, {
      bold: true,
      size: 14,
      color: rgb(0.07, 0.12, 0.27),
    })
    c.y -= 2
    c = drawKeyValue(c, 'Country / currency:', `${s.country ?? '—'} · ${s.currency}`, fonts)
    c = drawKeyValue(c, 'Visits:', String(s.visitsCount), fonts)
    c = drawKeyValue(c, 'Revenue (gross):', formatMoney(s.revenueCents, s.currency), fonts)
    c = drawKeyValue(
      c,
      'Expenses:',
      `${s.expensesCount} · ${formatMoney(s.expensesCents, s.currency)}`,
      fonts,
    )
    c = drawKeyValue(
      c,
      'Net (revenue − expenses):',
      formatMoney(s.revenueCents - s.expensesCents, s.currency),
      fonts,
    )
    c = drawKeyValue(
      c,
      'Clients / staff / services:',
      `${s.clientsCount} / ${s.staffCount} / ${s.servicesCount}`,
      fonts,
    )
    c = drawKeyValue(
      c,
      'Visit period:',
      `${formatDate(s.firstVisitAt)} → ${formatDate(s.lastVisitAt)}`,
      fonts,
    )
    c.y -= 10
  }

  // Footer-блок: правовая ремарка
  c = ensureSpace(doc, c, 100)
  c.y -= 6
  c = drawLine(c, 'Notes', fonts, { bold: true, size: 12 })
  const notes = [
    '• Money values are stored in minor units (cents); CSVs use *_cents suffix.',
    '• Revenue is calculated as sum(amount + tip − discount) over visits.',
    '• Receipt files (uploaded photos / PDFs) are NOT included in this archive.',
    '  Contact info@finkley.app to request a separate receipts archive.',
    '• This document is generated automatically and superseded by every newer export.',
  ]
  for (const n of notes) c = drawLine(c, n, fonts, { size: 10, color: rgb(0.4, 0.4, 0.45) })

  return doc.save()
}
