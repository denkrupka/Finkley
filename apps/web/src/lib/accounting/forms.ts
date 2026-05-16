/**
 * Каталог польских правных форм + форм налогообложения + ставок.
 * Используется в Settings → Профиль → Бухгалтерия (image #122).
 *
 * Контент в pl-локали (юзер видит названия как они звучат в польской
 * налоговой реальности), даже если интерфейс на русском — это сознательно:
 * бухгалтеру и юристу так привычнее, не нужно держать русскую кальку.
 *
 * Структура трёхуровневая:
 *   LegalForm.value     — выбор юрисдикции компании (JDG / Sp. z o.o. / ...)
 *     ↓
 *   TaxForm.value       — режим налогообложения, доступный для этой формы
 *     ↓
 *   TaxRateOption.value — конкретная ставка (если форма поддерживает несколько)
 *
 * Если у формы налогообложения rates=[] — ставка вырождена/нерелевантна
 * (например, karta podatkowa — индивидуальный аккорд с urzędem).
 *
 * Источник: stan na 2024 r. Если законодательство меняется, обновляем
 * здесь (это просто данные, без миграций БД).
 */

export type TaxRateOption = {
  value: number
  /** Подпись пользователю (с кратким контекстом, если ставка не очевидна). */
  label: string
}

export type TaxForm = {
  value: string
  label: string
  /** Возможные ставки. Если массив пуст — UI не показывает селект ставки. */
  rates: TaxRateOption[]
}

export type LegalForm = {
  value: string
  label: string
  tax_forms: TaxForm[]
}

export const LEGAL_FORMS: LegalForm[] = [
  {
    value: 'jdg',
    label: 'JDG (Jednoosobowa działalność gospodarcza)',
    tax_forms: [
      {
        value: 'skala',
        label: 'Zasady ogólne (skala podatkowa)',
        rates: [
          { value: 12, label: '12% (do 120 000 zł)' },
          { value: 32, label: '32% (powyżej 120 000 zł)' },
        ],
      },
      {
        value: 'liniowy',
        label: 'Podatek liniowy',
        rates: [{ value: 19, label: '19%' }],
      },
      {
        value: 'ryczalt',
        label: 'Ryczałt od przychodów ewidencjonowanych',
        rates: [
          { value: 17, label: '17%' },
          { value: 15, label: '15%' },
          { value: 14, label: '14%' },
          { value: 12.5, label: '12.5%' },
          { value: 12, label: '12%' },
          { value: 10, label: '10%' },
          { value: 8.5, label: '8.5% (usługi osobiste, kosmetyczne)' },
          { value: 5.5, label: '5.5%' },
          { value: 3, label: '3%' },
          { value: 2, label: '2%' },
        ],
      },
      {
        value: 'karta',
        label: 'Karta podatkowa (kontynuacja, tylko dla istniejących)',
        rates: [],
      },
    ],
  },
  {
    value: 'sp_zoo',
    label: 'Sp. z o.o. (Spółka z ograniczoną odpowiedzialnością)',
    tax_forms: [
      {
        value: 'cit',
        label: 'CIT',
        rates: [
          { value: 9, label: '9% (mały podatnik, przychód < 2 mln €)' },
          { value: 19, label: '19%' },
        ],
      },
      {
        value: 'estonski_cit',
        label: 'Estoński CIT (ryczałt od dochodów spółek)',
        rates: [
          { value: 10, label: '10% (mały podatnik / start-up)' },
          { value: 20, label: '20%' },
        ],
      },
    ],
  },
  {
    value: 'sp_jawna',
    label: 'Spółka jawna',
    tax_forms: [
      {
        value: 'skala',
        label: 'Zasady ogólne (skala — na poziomie wspólników)',
        rates: [
          { value: 12, label: '12% (do 120 000 zł na wspólnika)' },
          { value: 32, label: '32% (powyżej)' },
        ],
      },
      {
        value: 'liniowy',
        label: 'Podatek liniowy (na poziomie wspólnika)',
        rates: [{ value: 19, label: '19%' }],
      },
    ],
  },
  {
    value: 'sp_komandytowa',
    label: 'Spółka komandytowa',
    tax_forms: [
      {
        value: 'cit',
        label: 'CIT (od 2021 r. — sp. komandytowa jest podatnikiem CIT)',
        rates: [
          { value: 9, label: '9% (mały podatnik)' },
          { value: 19, label: '19%' },
        ],
      },
    ],
  },
  {
    value: 's_a',
    label: 'S.A. (Spółka akcyjna)',
    tax_forms: [
      {
        value: 'cit',
        label: 'CIT',
        rates: [{ value: 19, label: '19%' }],
      },
      {
        value: 'estonski_cit',
        label: 'Estoński CIT',
        rates: [{ value: 20, label: '20%' }],
      },
    ],
  },
  {
    value: 'fundacja',
    label: 'Fundacja',
    tax_forms: [
      {
        value: 'cit',
        label: 'CIT',
        rates: [
          { value: 0, label: '0% (zwolniona, działalność statutowa)' },
          { value: 19, label: '19%' },
        ],
      },
    ],
  },
  {
    value: 'inne',
    label: 'Inne',
    tax_forms: [],
  },
]

export function getLegalForm(value: string | null | undefined): LegalForm | null {
  if (!value) return null
  return LEGAL_FORMS.find((f) => f.value === value) ?? null
}

export function getTaxForm(legal: string | null | undefined, tax: string | null | undefined) {
  const lf = getLegalForm(legal)
  if (!lf || !tax) return null
  return lf.tax_forms.find((f) => f.value === tax) ?? null
}
