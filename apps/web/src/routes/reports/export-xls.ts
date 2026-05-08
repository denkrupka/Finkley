/**
 * Минимальный Excel-экспорт без зависимостей. Excel/Numbers/LibreOffice
 * понимают HTML-таблицу с MIME `application/vnd.ms-excel` как .xls — это
 * legacy-трюк, но работает с Office 97 до 365 включительно. Без подключения
 * sheet.js (~200 KB) и без новых deps.
 *
 * Альтернатива — CSV. Делаем оба формата: пользователь выбирает.
 */

export interface XlsTable {
  /** Заголовок листа (отображается как <h2> над таблицей в HTML, в Excel — как первая строка). */
  title: string
  /** Названия колонок. */
  headers: string[]
  /** Строки. Числа форматируются в Excel автоматически, строки экранируются. */
  rows: Array<Array<string | number | null>>
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cellToHtml(v: string | number | null): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  return escapeHtml(v)
}

/**
 * Сериализует один или несколько «листов» в HTML, понятный Excel'у при
 * сохранении как .xls. Несколько таблиц подряд — Excel импортирует на один
 * sheet через пробел, в новых версиях — корректно расставляет.
 */
export function buildXlsHtml(tables: XlsTable[], meta: { fileTitle: string }): string {
  const body = tables
    .map((t) => {
      const head = `<tr>${t.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
      const rows = t.rows
        .map((r) => `<tr>${r.map((c) => `<td>${cellToHtml(c)}</td>`).join('')}</tr>`)
        .join('')
      return `<h3>${escapeHtml(t.title)}</h3><table border="1">${head}${rows}</table><br>`
    })
    .join('\n')
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(meta.fileTitle)}</title></head>
<body>${body}</body></html>`
}

export function downloadAsXls(tables: XlsTable[], filename: string) {
  const html = buildXlsHtml(tables, { fileTitle: filename })
  // BOM нужен Excel'у чтобы корректно прочесть UTF-8 (кириллицу/польский).
  const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xls') ? filename : `${filename}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
