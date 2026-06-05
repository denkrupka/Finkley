/**
 * Дефолты для онбординга — выводятся из выбранной страны и типа салона.
 * Вынесены в отдельный модуль чтобы переиспользовать в шагах и при сабмите.
 */

/**
 * Bug c23825f2 + 4d4c58d5 + db360d8a + 4cd36954: расширили список стран и
 * добавили метаданные tax_id (NIP / DIČ / Steuernummer / etc.) — лейбл,
 * placeholder и regex для валидации. По этим же данным VAT lookup и подпись
 * в UI больше не «прибиты к Польше».
 */
export const COUNTRY_OPTIONS = [
  {
    code: 'PL',
    name: 'Польша',
    currency: 'PLN',
    timezone: 'Europe/Warsaw',
    tax_id_label: 'NIP',
    tax_id_placeholder: '1234567890',
    tax_id_pattern: '^\\d{10}$',
  },
  {
    code: 'DE',
    name: 'Германия',
    currency: 'EUR',
    timezone: 'Europe/Berlin',
    tax_id_label: 'USt-IdNr.',
    tax_id_placeholder: 'DE123456789',
    tax_id_pattern: '^DE\\d{9}$',
  },
  {
    code: 'CZ',
    name: 'Чехия',
    currency: 'CZK',
    timezone: 'Europe/Prague',
    tax_id_label: 'DIČ',
    tax_id_placeholder: 'CZ12345678',
    tax_id_pattern: '^CZ\\d{8,10}$',
  },
  {
    code: 'SK',
    name: 'Словакия',
    currency: 'EUR',
    timezone: 'Europe/Bratislava',
    tax_id_label: 'IČ DPH',
    tax_id_placeholder: 'SK1234567890',
    tax_id_pattern: '^SK\\d{10}$',
  },
  {
    code: 'HU',
    name: 'Венгрия',
    currency: 'HUF',
    timezone: 'Europe/Budapest',
    tax_id_label: 'Adószám',
    tax_id_placeholder: 'HU12345678',
    tax_id_pattern: '^HU\\d{8}$',
  },
  {
    code: 'AT',
    name: 'Австрия',
    currency: 'EUR',
    timezone: 'Europe/Vienna',
    tax_id_label: 'UID-Nummer',
    tax_id_placeholder: 'ATU12345678',
    tax_id_pattern: '^ATU\\d{8}$',
  },
  {
    code: 'LT',
    name: 'Литва',
    currency: 'EUR',
    timezone: 'Europe/Vilnius',
    tax_id_label: 'PVM kodas',
    tax_id_placeholder: 'LT123456789',
    tax_id_pattern: '^LT\\d{9,12}$',
  },
  {
    code: 'LV',
    name: 'Латвия',
    currency: 'EUR',
    timezone: 'Europe/Riga',
    tax_id_label: 'PVN reģ. nr.',
    tax_id_placeholder: 'LV12345678901',
    tax_id_pattern: '^LV\\d{11}$',
  },
  {
    code: 'EE',
    name: 'Эстония',
    currency: 'EUR',
    timezone: 'Europe/Tallinn',
    tax_id_label: 'KMKR nr.',
    tax_id_placeholder: 'EE123456789',
    tax_id_pattern: '^EE\\d{9}$',
  },
  {
    code: 'RO',
    name: 'Румыния',
    currency: 'RON',
    timezone: 'Europe/Bucharest',
    tax_id_label: 'CIF',
    tax_id_placeholder: 'RO12345678',
    tax_id_pattern: '^RO\\d{2,10}$',
  },
  {
    code: 'BG',
    name: 'Болгария',
    currency: 'BGN',
    timezone: 'Europe/Sofia',
    tax_id_label: 'EIK',
    tax_id_placeholder: 'BG123456789',
    tax_id_pattern: '^BG\\d{9,10}$',
  },
  {
    code: 'UA',
    name: 'Украина',
    currency: 'UAH',
    timezone: 'Europe/Kyiv',
    tax_id_label: 'ЄДРПОУ / ІПН',
    tax_id_placeholder: '12345678',
    tax_id_pattern: '^\\d{8,10}$',
  },
] as const

export type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code']

/** Bug 4d4c58d5/db360d8a — подпись поля «NIP» по выбранной стране. */
export function taxIdLabelFor(code: CountryCode | string | null | undefined): string {
  const c = COUNTRY_OPTIONS.find((co) => co.code === (code ?? 'PL'))
  return c?.tax_id_label ?? 'Tax ID'
}

/** Placeholder с примером формата tax-ID для выбранной страны. */
export function taxIdPlaceholderFor(code: CountryCode | string | null | undefined): string {
  const c = COUNTRY_OPTIONS.find((co) => co.code === (code ?? 'PL'))
  return c?.tax_id_placeholder ?? ''
}

export const SALON_TYPES = [
  { id: 'hair', name: 'Парикмахерская' },
  { id: 'nails', name: 'Маникюрный салон' },
  { id: 'spa', name: 'Спа салон' },
  { id: 'massage', name: 'Студия массажа' },
  { id: 'barber', name: 'Барбершоп' },
  { id: 'cosmetology', name: 'Косметология' },
  { id: 'tattoo', name: 'Тату студия' },
  { id: 'other', name: 'Другое' },
] as const

export type SalonTypeId = (typeof SALON_TYPES)[number]['id']

/**
 * Дефолтные специализации мастеров — используются как pills
 * на шаге 2 (TASK-08). Можно множественно выбрать.
 */
export const STAFF_SPECIALTIES = [
  'Маникюр',
  'Педикюр',
  'Брови',
  'Ресницы',
  'Стрижки',
  'Окрашивание',
  'Укладка',
  'Массаж',
  'Депиляция',
  'Косметология',
] as const

/**
 * Seed-каталоги услуг по типу салона (для шага 3).
 * Каждая услуга — `{ category_name, name, default_price_cents }`.
 * Цены в EUR-копейках как заглушки; в форме редактируемые.
 */
export const SEED_SERVICES_BY_TYPE: Record<
  SalonTypeId,
  { category_name: string; name: string; default_price_cents: number }[]
> = {
  hair: [
    { category_name: 'Стрижки', name: 'Женская стрижка', default_price_cents: 4000 },
    { category_name: 'Стрижки', name: 'Мужская стрижка', default_price_cents: 3000 },
    { category_name: 'Окрашивание', name: 'Окрашивание целиком', default_price_cents: 12000 },
    { category_name: 'Окрашивание', name: 'Окрашивание корней', default_price_cents: 8000 },
    { category_name: 'Укладка', name: 'Укладка', default_price_cents: 3500 },
  ],
  nails: [
    { category_name: 'Маникюр', name: 'Маникюр гель', default_price_cents: 4000 },
    { category_name: 'Маникюр', name: 'Маникюр классический', default_price_cents: 2500 },
    { category_name: 'Педикюр', name: 'Педикюр', default_price_cents: 5000 },
    { category_name: 'Дизайн', name: 'Дизайн ногтей', default_price_cents: 1500 },
  ],
  spa: [
    { category_name: 'Массаж', name: 'Массаж классический', default_price_cents: 6000 },
    { category_name: 'Уход', name: 'Уход за лицом', default_price_cents: 8000 },
    { category_name: 'Уход', name: 'Депиляция', default_price_cents: 4000 },
  ],
  barber: [
    { category_name: 'Стрижки', name: 'Мужская стрижка', default_price_cents: 3000 },
    { category_name: 'Стрижки', name: 'Стрижка + борода', default_price_cents: 4500 },
    { category_name: 'Борода', name: 'Бритьё', default_price_cents: 2500 },
  ],
  cosmetology: [
    { category_name: 'Чистка', name: 'Чистка лица', default_price_cents: 8000 },
    { category_name: 'Пилинг', name: 'Пилинг', default_price_cents: 6000 },
    { category_name: 'Уколы', name: 'Уколы красоты', default_price_cents: 25000 },
  ],
  massage: [
    { category_name: 'Массаж', name: 'Массаж классический', default_price_cents: 6000 },
    { category_name: 'Массаж', name: 'Массаж спортивный', default_price_cents: 7000 },
    { category_name: 'Массаж', name: 'Антицеллюлитный массаж', default_price_cents: 8000 },
  ],
  tattoo: [
    { category_name: 'Тату', name: 'Минимализм / small', default_price_cents: 15000 },
    { category_name: 'Тату', name: 'Средняя работа (1-3 часа)', default_price_cents: 45000 },
    { category_name: 'Тату', name: 'Большая работа (сеанс)', default_price_cents: 80000 },
    { category_name: 'Тату', name: 'Коррекция / cover-up', default_price_cents: 25000 },
  ],
  other: [],
}

/**
 * Дефолтные категории расходов — 7 штук из docs/03_DATA_MODEL.md.
 * is_system=true ставит RPC.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Аренда',
  'Зарплата мастерам',
  'Материалы',
  'Реклама',
  'Коммунальные услуги',
  'Обучение',
  'Прочее',
] as const
