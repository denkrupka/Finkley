/**
 * Список государственных праздников европейских стран.
 *
 * Подход: жёстко прописаны фиксированные даты (XX января, YY мая и т.п.)
 * плюс крупные подвижные (Пасха, Троица) рассчитываются формулой Gauss.
 * Это покрывает 90% случаев без подключения тяжёлой библиотеки типа
 * `date-holidays` (~500 KB) для MVP.
 *
 * Если страна не поддерживается — пользователь добавляет выходные руками.
 */

export type Holiday = {
  /** ISO date YYYY-MM-DD */
  date: string
  /** Локализованное название */
  label: string
}

export type HolidayCountry = {
  code: string
  /** Локализованное имя страны (для button label) */
  label: string
  /** Эмодзи флаг */
  flag: string
}

export const HOLIDAY_COUNTRIES: HolidayCountry[] = [
  { code: 'PL', label: 'Польша', flag: '🇵🇱' },
  { code: 'CZ', label: 'Чехия', flag: '🇨🇿' },
  { code: 'SK', label: 'Словакия', flag: '🇸🇰' },
  { code: 'DE', label: 'Германия', flag: '🇩🇪' },
  { code: 'AT', label: 'Австрия', flag: '🇦🇹' },
  { code: 'IT', label: 'Италия', flag: '🇮🇹' },
  { code: 'ES', label: 'Испания', flag: '🇪🇸' },
  { code: 'FR', label: 'Франция', flag: '🇫🇷' },
  { code: 'PT', label: 'Португалия', flag: '🇵🇹' },
  { code: 'NL', label: 'Нидерланды', flag: '🇳🇱' },
  { code: 'BE', label: 'Бельгия', flag: '🇧🇪' },
  { code: 'GB', label: 'Великобритания', flag: '🇬🇧' },
  { code: 'IE', label: 'Ирландия', flag: '🇮🇪' },
  { code: 'GR', label: 'Греция', flag: '🇬🇷' },
  { code: 'UA', label: 'Украина', flag: '🇺🇦' },
  { code: 'LT', label: 'Литва', flag: '🇱🇹' },
  { code: 'LV', label: 'Латвия', flag: '🇱🇻' },
  { code: 'EE', label: 'Эстония', flag: '🇪🇪' },
  { code: 'HU', label: 'Венгрия', flag: '🇭🇺' },
  { code: 'RO', label: 'Румыния', flag: '🇷🇴' },
  { code: 'BG', label: 'Болгария', flag: '🇧🇬' },
  { code: 'HR', label: 'Хорватия', flag: '🇭🇷' },
  { code: 'SI', label: 'Словения', flag: '🇸🇮' },
  { code: 'SE', label: 'Швеция', flag: '🇸🇪' },
  { code: 'NO', label: 'Норвегия', flag: '🇳🇴' },
  { code: 'FI', label: 'Финляндия', flag: '🇫🇮' },
  { code: 'DK', label: 'Дания', flag: '🇩🇰' },
  { code: 'CH', label: 'Швейцария', flag: '🇨🇭' },
]

/** Gauss algorithm — Пасха (Западная) для year. Возвращает {month, day}. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

function dateIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function addDays(year: number, month: number, day: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + delta)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Возвращает праздники страны на указанный год.
 * Если страна не поддерживается — пустой массив.
 */
export function getHolidays(country: string, year: number): Holiday[] {
  const easter = easterSunday(year)
  const easterMonday = addDays(year, easter.month, easter.day, 1)
  const goodFriday = addDays(year, easter.month, easter.day, -2)
  const pentecost = addDays(year, easter.month, easter.day, 49)
  const corpus = addDays(year, easter.month, easter.day, 60)
  const ascension = addDays(year, easter.month, easter.day, 39)

  switch (country) {
    case 'PL':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 3), label: 'День Конституции' },
        { date: pentecost, label: 'Троица' },
        { date: corpus, label: 'Тело Господне' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 11, 11), label: 'День независимости' },
        { date: dateIso(year, 12, 25), label: 'Рождество (1-й день)' },
        { date: dateIso(year, 12, 26), label: 'Рождество (2-й день)' },
      ]
    case 'CZ':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 8), label: 'День освобождения' },
        { date: dateIso(year, 7, 5), label: 'Кирилл и Мефодий' },
        { date: dateIso(year, 7, 6), label: 'Ян Гус' },
        { date: dateIso(year, 9, 28), label: 'День чешской государственности' },
        { date: dateIso(year, 10, 28), label: 'День независимой Чехословакии' },
        { date: dateIso(year, 11, 17), label: 'День борьбы за свободу' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'День Святого Стефана' },
      ]
    case 'SK':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 8), label: 'День победы' },
        { date: dateIso(year, 7, 5), label: 'Кирилл и Мефодий' },
        { date: dateIso(year, 8, 29), label: 'Словацкое восстание' },
        { date: dateIso(year, 9, 1), label: 'День Конституции' },
        { date: dateIso(year, 9, 15), label: 'День Богоматери' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 11, 17), label: 'День борьбы за свободу' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'День Святого Стефана' },
      ]
    case 'DE':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 10, 3), label: 'День объединения' },
        { date: dateIso(year, 12, 25), label: 'Рождество (1-й день)' },
        { date: dateIso(year, 12, 26), label: 'Рождество (2-й день)' },
      ]
    case 'AT':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: corpus, label: 'Тело Господне' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 10, 26), label: 'Национальный праздник' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 8), label: 'Непорочное зачатие' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'День Святого Стефана' },
      ]
    case 'IT':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 4, 25), label: 'День освобождения' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 6, 2), label: 'День Республики' },
        { date: dateIso(year, 8, 15), label: 'Феррагосто' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 8), label: 'Непорочное зачатие' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'День Святого Стефана' },
      ]
    case 'ES':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 10, 12), label: 'Национальный день' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 6), label: 'День Конституции' },
        { date: dateIso(year, 12, 8), label: 'Непорочное зачатие' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
      ]
    case 'FR':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 8), label: 'День Победы' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 7, 14), label: 'День взятия Бастилии' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 11, 11), label: 'День перемирия' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
      ]
    case 'PT':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: dateIso(year, 4, 25), label: 'День свободы' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 6, 10), label: 'День Португалии' },
        { date: corpus, label: 'Тело Господне' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 10, 5), label: 'День Республики' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 1), label: 'День независимости' },
        { date: dateIso(year, 12, 8), label: 'Непорочное зачатие' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
      ]
    case 'NL':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 4, 27), label: 'День короля' },
        { date: dateIso(year, 5, 5), label: 'День освобождения' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 12, 25), label: 'Рождество (1-й день)' },
        { date: dateIso(year, 12, 26), label: 'Рождество (2-й день)' },
      ]
    case 'BE':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 7, 21), label: 'Национальный день' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 11, 11), label: 'День перемирия' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
      ]
    case 'GB':
      return [
        { date: dateIso(year, 1, 1), label: "New Year's Day" },
        { date: goodFriday, label: 'Good Friday' },
        { date: easterMonday, label: 'Easter Monday' },
        { date: dateIso(year, 12, 25), label: 'Christmas Day' },
        { date: dateIso(year, 12, 26), label: 'Boxing Day' },
      ]
    case 'IE':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 3, 17), label: 'День святого Патрика' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'День Святого Стефана' },
      ]
    case 'GR':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: dateIso(year, 3, 25), label: 'День независимости' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 10, 28), label: 'День Охи' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Собор Богородицы' },
      ]
    case 'UA':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 3, 8), label: 'Международный женский день' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 9), label: 'День памяти и победы' },
        { date: dateIso(year, 6, 28), label: 'День Конституции' },
        { date: dateIso(year, 8, 24), label: 'День независимости' },
        { date: dateIso(year, 10, 14), label: 'День защитников Украины' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
      ]
    case 'LT':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 2, 16), label: 'День восстановления государства' },
        { date: dateIso(year, 3, 11), label: 'День независимости' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 6, 24), label: 'Иоаннов день' },
        { date: dateIso(year, 7, 6), label: 'День государственности' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество (1-й день)' },
        { date: dateIso(year, 12, 26), label: 'Рождество (2-й день)' },
      ]
    case 'LV':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 4), label: 'День восстановления независимости' },
        { date: dateIso(year, 6, 23), label: 'Канун Иванова дня' },
        { date: dateIso(year, 6, 24), label: 'Иванов день' },
        { date: dateIso(year, 11, 18), label: 'День провозглашения' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Второй день Рождества' },
      ]
    case 'EE':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 2, 24), label: 'День независимости' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 6, 23), label: 'День Победы' },
        { date: dateIso(year, 6, 24), label: 'Янов день' },
        { date: dateIso(year, 8, 20), label: 'День восстановления независимости' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Второй день Рождества' },
      ]
    case 'HU':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 3, 15), label: 'День революции' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 8, 20), label: 'День Святого Стефана' },
        { date: dateIso(year, 10, 23), label: 'День Республики' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 25), label: 'Рождество (1-й день)' },
        { date: dateIso(year, 12, 26), label: 'Рождество (2-й день)' },
      ]
    case 'RO':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 2), label: 'Второй день Нового года' },
        { date: dateIso(year, 1, 24), label: 'День объединения Княжеств' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 6, 1), label: 'День защиты детей' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 11, 30), label: 'День Святого Андрея' },
        { date: dateIso(year, 12, 1), label: 'Национальный день' },
        { date: dateIso(year, 12, 25), label: 'Рождество (1-й день)' },
        { date: dateIso(year, 12, 26), label: 'Рождество (2-й день)' },
      ]
    case 'BG':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 3, 3), label: 'День освобождения' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 6), label: 'День Святого Георгия' },
        { date: dateIso(year, 5, 24), label: 'День культуры' },
        { date: dateIso(year, 9, 6), label: 'День объединения' },
        { date: dateIso(year, 9, 22), label: 'День независимости' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Второй день Рождества' },
      ]
    case 'HR':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: corpus, label: 'Тело Господне' },
        { date: dateIso(year, 6, 22), label: 'День антифашистской борьбы' },
        { date: dateIso(year, 6, 25), label: 'День государственности' },
        { date: dateIso(year, 8, 5), label: 'День Благодарения' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'День Святого Стефана' },
      ]
    case 'SI':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 2), label: 'Второй день Нового года' },
        { date: dateIso(year, 2, 8), label: 'День культуры' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 4, 27), label: 'День сопротивления' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 2), label: 'Второй день Труда' },
        { date: dateIso(year, 6, 25), label: 'День государственности' },
        { date: dateIso(year, 8, 15), label: 'Успение Богородицы' },
        { date: dateIso(year, 10, 31), label: 'День Реформации' },
        { date: dateIso(year, 11, 1), label: 'День всех святых' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'День независимости' },
      ]
    case 'SE':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: ascension, label: 'Вознесение' },
        { date: dateIso(year, 6, 6), label: 'Национальный день' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Второй день Рождества' },
        { date: dateIso(year, 12, 31), label: 'Канун Нового года' },
      ]
    case 'NO':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: dateIso(year, 5, 17), label: 'Национальный день' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Второй день Рождества' },
      ]
    case 'FI':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: dateIso(year, 1, 6), label: 'Богоявление' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: dateIso(year, 5, 1), label: 'Праздник Труда' },
        { date: ascension, label: 'Вознесение' },
        { date: dateIso(year, 6, 24), label: 'Иванов день (канун)' },
        { date: dateIso(year, 12, 6), label: 'День независимости' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Второй день Рождества' },
      ]
    case 'DK':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 6, 5), label: 'День Конституции' },
        { date: dateIso(year, 12, 24), label: 'Сочельник' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
        { date: dateIso(year, 12, 26), label: 'Второй день Рождества' },
      ]
    case 'CH':
      return [
        { date: dateIso(year, 1, 1), label: 'Новый год' },
        { date: goodFriday, label: 'Страстная пятница' },
        { date: easterMonday, label: 'Пасхальный понедельник' },
        { date: ascension, label: 'Вознесение' },
        { date: addDays(year, easter.month, easter.day, 50), label: 'Духов день' },
        { date: dateIso(year, 8, 1), label: 'Национальный день' },
        { date: dateIso(year, 12, 25), label: 'Рождество' },
      ]
    default:
      return []
  }
}
