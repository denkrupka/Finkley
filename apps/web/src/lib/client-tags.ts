/**
 * Маппинг технических тегов клиентов на человекочитаемые лейблы.
 * Эти теги генерируются автоматически: Booksy импорт (booksy:*), фильтры
 * аналитики и т.д. Юзеру показываем понятные RU-фразы вместо
 * «#booksy:frequent_no_show».
 *
 * Если тег не маппится — возвращаем строку без префикса `booksy:` и
 * заменяем подчёркивания на пробелы. То есть `booksy:vip` → «vip».
 */

const KNOWN_TAGS: Record<string, string> = {
  'booksy:app_user': 'Клиент Booksy',
  'booksy:blacklisted': 'В чёрном списке',
  'booksy:from_promo': 'Пришёл по промо',
  'booksy:frequent_no_show': 'Часто не приходит',
  'booksy:vip_loyal': 'VIP — постоянный',
  'booksy:vip_top_spender': 'VIP — топ-чек',
  // status-теги от RFM/аналитики
  active: 'Активный',
  at_risk: 'Под угрозой ухода',
  churned: 'Ушёл',
  new: 'Новый',
  vip: 'VIP',
}

/**
 * Превращает технический тег в человекочитаемый лейбл.
 * Если тег неизвестен — возвращает его очищенным от namespace-префиксов
 * и подчёркиваний.
 */
export function humanizeTag(tag: string): string {
  if (tag in KNOWN_TAGS) return KNOWN_TAGS[tag]!
  // Снимаем namespace `booksy:` и подчёркивания → пробелы
  const noPrefix = tag.replace(/^[a-z]+:/, '')
  return noPrefix.replace(/_/g, ' ')
}
