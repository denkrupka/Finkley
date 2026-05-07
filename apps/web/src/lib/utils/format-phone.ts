import {
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from 'libphonenumber-js/min'

/**
 * Phone helpers для русско-/польско-/украинско-говорящих юзеров.
 *
 * Используется `libphonenumber-js/min` вариант — это ~80 KB вместо ~140 KB
 * у `max`. Покрывает все мобильные/landline номера всех стран; теряем только
 * редкие geographical/non-geographical edge cases, которые нам не нужны.
 *
 * Нормализация:
 *   - Возвращает E.164 (+48...) если введённое валидно.
 *   - Если ввели локально без префикса — пробуем угадать по country.
 *   - Если совсем мусор — null. Сохраняем raw input в поле phone (без E.164),
 *     но в БД лучше не пускать невалидные через UI: вернём toast с ошибкой.
 *
 * Форматирование на UI: international (+48 600 12 34 56). Поиск по телефону
 * сравниваем с E.164 — поэтому БД хранит E.164.
 *
 * Note: лёгкий `normalizeSearchPhone` вынесен в `phone-search.ts` — оттуда
 * его берёт useClients, чтобы не тянуть в индекс-bundle всю libphonenumber.
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

// normalizeSearchPhone переехал в `./phone-search.ts` — он нужен в useClients,
// который грузится eagerly через QuickEntryModal; держать его в этом файле
// притаскивало бы libphonenumber-js в основной bundle.
export { normalizeSearchPhone } from './phone-search'
