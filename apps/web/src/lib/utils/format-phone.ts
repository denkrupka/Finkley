import { parsePhoneNumberFromString, type CountryCode, type PhoneNumber } from 'libphonenumber-js'

/**
 * Phone helpers для русско-/польско-/украинско-говорящих юзеров.
 *
 * Нормализация:
 *   - Возвращает E.164 (+48...) если введённое валидно.
 *   - Если ввели локально без префикса — пробуем угадать по country.
 *   - Если совсем мусор — null. Сохраняем raw input в поле phone (без E.164),
 *     но в БД лучше не пускать невалидные через UI: вернём toast с ошибкой.
 *
 * Форматирование на UI: international (+48 600 12 34 56). Поиск по телефону
 * сравниваем с E.164 — поэтому БД хранит E.164.
 */

const DEFAULT_COUNTRY: CountryCode = 'PL'

export function parsePhone(
  input: string,
  country: CountryCode = DEFAULT_COUNTRY,
): PhoneNumber | null {
  if (!input.trim()) return null
  return parsePhoneNumberFromString(input, country) ?? null
}

/**
 * Возвращает E.164 (например, +48600123456) если ввод валиден.
 * null — если ввод невалидный (сохраняем raw input как fallback).
 */
export function toE164(input: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  const parsed = parsePhone(input, country)
  if (!parsed || !parsed.isValid()) return null
  return parsed.number
}

/**
 * Красивый формат для отображения: «+48 600 12 34 56».
 * Если ввод не парсится — отдаём как есть (fallback).
 */
export function formatPhoneDisplay(
  input: string | null | undefined,
  country: CountryCode = DEFAULT_COUNTRY,
): string {
  if (!input) return ''
  const parsed = parsePhone(input, country)
  if (!parsed) return input
  return parsed.formatInternational()
}

/**
 * Для поиска: убираем всё кроме цифр (и +). Сравниваем clientPhoneE164 startsWith
 * нормализованным запросом. То есть "600 12" найдёт "+48600123456".
 */
export function normalizeSearchPhone(input: string): string {
  return input.replace(/[^\d+]/g, '')
}
