/**
 * Маппинг расходов inFakt → дефолтные категории Finkley.
 * Идентично паттерну fakturownia-proxy/category-mapping.ts.
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
    keywords: ['wynagrodzenie', 'pensja', 'salary', 'zlecenie', 'umowa', 'зарплат'],
  },
  {
    category: 'Материалы',
    keywords: ['kosmetyk', 'materiał', 'farba', 'lakier', 'szampon', 'материал', 'краска'],
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
      'реклам',
      'таргет',
    ],
  },
  {
    category: 'Коммунальные',
    keywords: ['prąd', 'energia', 'gaz', 'woda', 'internet', 'telefon', 'коммун', 'связь'],
  },
  { category: 'Обучение', keywords: ['szkolenie', 'kurs', 'training', 'webinar', 'обучен'] },
]

export function mapInfaktToFinkleyCategory(input: {
  vendorName?: string | null
  description?: string | null
}): FinkleyCategory | null {
  const haystack = [input.vendorName, input.description].filter(Boolean).join(' ').toLowerCase()
  if (!haystack) return null
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw)) return rule.category
    }
  }
  return null
}
