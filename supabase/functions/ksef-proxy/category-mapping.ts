/**
 * Маппинг входящих фактур КСеФ → дефолтные категории Finkley.
 *
 * КСеФ FA(2) даёт описание услуги/товара в P_7, иногда контрагента и счёт-фактуру.
 * Структурированной «категории» там нет — keyword-матчинг по PL/RU словам.
 *
 * Целевые категории — 7 системных, создаваемых при онбординге (TASK-08, шаг 4):
 *   Аренда / Зарплата / Материалы / Реклама / Коммунальные / Обучение / Прочее
 *
 * Идентичен `wfirma-proxy/category-mapping.ts` — отдельная копия чтобы edge
 * functions не зависели друг от друга. Когда копий станет 3+ — переедет
 * в `_shared/`.
 */

export type FinkleyCategory =
  | 'Аренда'
  | 'Зарплата'
  | 'Материалы'
  | 'Реклама'
  | 'Коммунальные'
  | 'Обучение'
  | 'Прочее'

const RULES: Array<{ category: FinkleyCategory; keywords: string[] }> = [
  {
    category: 'Аренда',
    keywords: ['czynsz', 'wynajem', 'najmu', 'lokal', 'rent', 'аренд', 'аренды'],
  },
  {
    category: 'Зарплата',
    keywords: [
      'wynagrodzenie',
      'pensja',
      'wynagrodzenia',
      'salary',
      'zlecenie',
      'umowa',
      'зарплат',
      'оклад',
      'премия',
    ],
  },
  {
    category: 'Материалы',
    keywords: [
      'kosmetyk',
      'materiał',
      'material',
      'farba',
      'lakier',
      'szampon',
      'odżywka',
      'product',
      'produkt',
      'товар',
      'расходник',
      'материал',
      'краска',
      'шампун',
      'крем',
    ],
  },
  {
    category: 'Реклама',
    keywords: [
      'reklama',
      'marketing',
      'promocja',
      'promo',
      'facebook',
      'instagram',
      'google ads',
      'meta ads',
      'реклам',
      'продвиж',
      'таргет',
    ],
  },
  {
    category: 'Коммунальные',
    keywords: [
      'prąd',
      'energia',
      'energii',
      'gaz',
      'woda',
      'wody',
      'ścieki',
      'internet',
      'telefon',
      'telekom',
      'orange',
      'play',
      'plus',
      't-mobile',
      'комм',
      'электр',
      'газ',
      'вод',
      'связь',
      'телефон',
    ],
  },
  {
    category: 'Обучение',
    keywords: [
      'szkolenie',
      'kurs',
      'training',
      'webinar',
      'обучен',
      'курс',
      'тренинг',
      'мастер-класс',
    ],
  },
]

export function mapKsefToFinkleyCategory(input: {
  description?: string | null
  sellerName?: string | null
}): FinkleyCategory | null {
  const haystack = [input.description, input.sellerName].filter(Boolean).join(' ').toLowerCase()
  if (!haystack) return null
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw)) return rule.category
    }
  }
  return null
}
