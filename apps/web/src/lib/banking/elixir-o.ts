/**
 * Генератор Elixir-O — польского формата bulk-przelewów. Принимается
 * большинством PL-банков для импорта злецений: PKO BP, mBank, Santander,
 * ING, Pekao, Millennium, Alior, Citi Handlowy, BNP Paribas, Crédit Agricole.
 *
 * Формат: одна строка = одно zlecenie. Поля разделены запятыми, многие
 * в двойных кавычках. Кодировка — ISO-8859-2 (Windows-1250) исторически;
 * UTF-8 тоже принимается современными банк-клиентами.
 *
 * Поля (порядок строго):
 *   1. typ: "110" — przelew krajowy
 *   2. data zlecenia YYYYMMDD
 *   3. kwota_w_groszach (integer)
 *   4. 0 (zarezerwowane)
 *   5. NRB zleceniodawcy (26 цифр без префикса PL)
 *   6. NRB beneficjenta
 *   7. "nazwa_zleceniodawcy" (4×35 символов max, разделённых "|")
 *   8. "nazwa_beneficjenta"
 *   9. 0
 *   10. 0
 *   11. "tytuł płatności" (4×35 max)
 *   12. ""
 *   13. 51 (klasyfikacja krajowa)
 *   14. "" (referencja klienta)
 *
 * Спека: https://elixir.kir.pl/standard-elixir/
 */

import { normalizeIban } from './iban'
import type { SepaInput, SepaPayment } from './sepa-xml'

/** PL NRB — 26 цифр без префикса PL и check-digits. */
function ibanToNrb(iban: string): string {
  const clean = normalizeIban(iban)
  // PL префикс — 2 буквы "PL", дальше 26 цифр
  if (!clean.startsWith('PL') || clean.length !== 28) {
    throw new Error(`Elixir-O работает только с польскими IBAN (PL + 26 цифр). Получено: ${clean}`)
  }
  return clean.slice(2)
}

/** Escape для Elixir-O текстового поля: режем |, заменяем " на ', обрезаем 4×35. */
function escapeElixirText(s: string): string {
  // 4 segments × 35 chars, разделённых "|". Берём первые 140 символов,
  // режем на куски по 35 и сшиваем через "|". Удаляем кавычки чтобы не
  // ломать парсер.
  const clean = s.replace(/"/g, "'").replace(/\|/g, '/').slice(0, 140)
  const segments: string[] = []
  for (let i = 0; i < clean.length; i += 35) {
    segments.push(clean.slice(i, i + 35))
  }
  return segments.join('|')
}

/** Заворачивает строку в двойные кавычки для Elixir-O. */
function quote(s: string): string {
  return `"${escapeElixirText(s)}"`
}

function dateYYYYMMDD(iso: string): string {
  return iso.replace(/-/g, '').slice(0, 8)
}

export function buildElixirO(input: SepaInput): string {
  if (input.payments.length === 0) throw new Error('Need at least one payment')
  const debtorNrb = ibanToNrb(input.debtorIban)
  const date = dateYYYYMMDD(input.executionDate)
  const debtorName = quote(input.debtorName)

  const lines: string[] = []
  for (const p of input.payments) {
    if (p.currency !== 'PLN') {
      throw new Error(
        `Elixir-O поддерживает только PLN. Платёж в ${p.currency} нужно отправить SEPA XML.`,
      )
    }
    const beneficiaryNrb = ibanToNrb(p.creditorIban)
    const fields = [
      '110',
      date,
      String(p.amountCents),
      '0',
      debtorNrb,
      beneficiaryNrb,
      debtorName,
      quote(p.creditorName),
      '0',
      '0',
      quote(p.remittance),
      '""',
      '51',
      '""',
    ]
    lines.push(fields.join(','))
  }
  // Elixir-O традиционно использует CRLF и заканчивается LF.
  return lines.join('\r\n') + '\r\n'
}

/**
 * Подмножество payments которые подходят для Elixir-O (только PL→PL переводы
 * в PLN). Для других — пользователь должен использовать SEPA XML.
 */
export function isElixirOCompatible(payment: SepaPayment, debtorIban: string): boolean {
  if (payment.currency !== 'PLN') return false
  const di = normalizeIban(debtorIban)
  const ci = normalizeIban(payment.creditorIban)
  return di.startsWith('PL') && ci.startsWith('PL') && di.length === 28 && ci.length === 28
}
