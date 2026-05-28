/**
 * Дефолты для онбординга — выводятся из выбранной страны и типа салона.
 * Вынесены в отдельный модуль чтобы переиспользовать в шагах и при сабмите.
 */

export const COUNTRY_OPTIONS = [
  { code: 'PL', name: 'Польша', currency: 'PLN', timezone: 'Europe/Warsaw' },
  { code: 'DE', name: 'Германия', currency: 'EUR', timezone: 'Europe/Berlin' },
  { code: 'LT', name: 'Литва', currency: 'EUR', timezone: 'Europe/Vilnius' },
  { code: 'CZ', name: 'Чехия', currency: 'CZK', timezone: 'Europe/Prague' },
  { code: 'EE', name: 'Эстония', currency: 'EUR', timezone: 'Europe/Tallinn' },
] as const

export type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code']

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
