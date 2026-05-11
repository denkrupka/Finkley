/**
 * Маппинг расходов Fakturownia → дефолтные категории Finkley.
 * Идентично паттерну ksef-proxy/category-mapping.ts.
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
  { category: 'Аренда', keywords: ['czynsz', 'wynajem', 'najmu', 'lokal', 'rent', 'аренд'] },
  {
    category: 'Зарплата',
    keywords: ['wynagrodzenie', 'pensja', 'salary', 'zlecenie', 'umowa', 'зарплат', 'оклад'],
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
      'материал',
      'краска',
      'крем',
    ],
  },
  {
    category: 'Реклама',
    keywords: [
      'reklama',
      'marketing',
      'promocja',
      'facebook',
      'instagram',
      'google ads',
      'meta ads',
      'реклам',
      'таргет',
    ],
  },
  {
    category: 'Коммунальные',
    keywords: [
      'prąd',
      'energia',
      'gaz',
      'woda',
      'ścieki',
      'internet',
      'telefon',
      'orange',
      'play',
      'plus',
      't-mobile',
      'комм',
      'электр',
      'вод',
      'связь',
    ],
  },
  {
    category: 'Обучение',
    keywords: ['szkolenie', 'kurs', 'training', 'webinar', 'обучен', 'курс', 'тренинг'],
  },
]

export function mapFakturowniaToFinkleyCategory(input: {
  name?: string | null
  description?: string | null
  category?: string | null
  buyerName?: string | null
}): FinkleyCategory | null {
  const haystack = [input.name, input.description, input.category, input.buyerName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!haystack) return null
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw)) return rule.category
    }
  }
  return null
}
