/**
 * Утилиты для IBAN: форматирование для UI и валидация по mod-97.
 * https://en.wikipedia.org/wiki/International_Bank_Account_Number
 */

/** Чистим пробелы, апперкейс. */
export function normalizeIban(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/\s+/g, '').toUpperCase()
}

/**
 * Группировка по 4 для отображения: "PL61 1090 1014 0000 0712 1981 2874".
 * Принимает уже грязный input (с пробелами или без).
 */
export function formatIbanForDisplay(raw: string | null | undefined): string {
  const clean = normalizeIban(raw)
  if (!clean) return ''
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean
}

/**
 * IBAN check по mod-97 = 1 (ISO 13616). Возвращает true для валидного.
 * Не валидирует BBAN bank-specific, только integrity.
 *
 * Алгоритм:
 *   1. Move first 4 chars to end
 *   2. Letters → digits (A=10, B=11, ..., Z=35)
 *   3. Парсим как BigInt, делим на 97, остаток должен быть 1
 */
export function isIbanValid(raw: string | null | undefined): boolean {
  const iban = normalizeIban(raw)
  if (iban.length < 15 || iban.length > 34) return false
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let numeric = ''
  for (const ch of rearranged) {
    if (ch >= 'A' && ch <= 'Z') {
      numeric += String(ch.charCodeAt(0) - 55) // A=10 ... Z=35
    } else {
      numeric += ch
    }
  }
  // BigInt чтобы вместить 28-значное число
  try {
    return BigInt(numeric) % 97n === 1n
  } catch {
    return false
  }
}

/**
 * Country code из IBAN (первые 2 буквы). Нужен для выбора банк-формата
 * в bulk-экспорте: PL → Elixir-O / SEPA, DE → SEPA только, etc.
 */
export function ibanCountry(raw: string | null | undefined): string | null {
  const clean = normalizeIban(raw)
  if (clean.length < 2) return null
  const cc = clean.slice(0, 2)
  return /^[A-Z]{2}$/.test(cc) ? cc : null
}
