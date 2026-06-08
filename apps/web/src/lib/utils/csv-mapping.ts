/**
 * Маппинг колонок CSV-выгрузок booking-платформ (Booksy/Fresha/Treatwell)
 * на доменные поля визита. Вынесено из ImportPage.tsx чтобы покрыть тестами.
 *
 * Treatwell Connect мультиязычен (de/fr/it/nl/…), и имена колонок в экспорте
 * зависят от локали салона. Поэтому:
 *   1. PLATFORM_TEMPLATES — точные имена колонок (EN + локали Treatwell),
 *      exact-match по lowercased заголовку. >=3 совпадений → платформа поймана.
 *   2. guessField — мультиязычная эвристика-фолбэк (RU/EN/PL/DE/FR/IT/NL).
 * Ручной маппинг в UI остаётся safety-net'ом, если авто-детект промахнулся.
 */

export type DomainField =
  | 'skip'
  | 'visit_at'
  | 'amount'
  | 'client_name'
  | 'client_phone'
  | 'service_name'
  | 'staff_name'
  | 'payment_method'
  | 'comment'

export const ALL_FIELDS: DomainField[] = [
  'skip',
  'visit_at',
  'amount',
  'client_name',
  'client_phone',
  'service_name',
  'staff_name',
  'payment_method',
  'comment',
]

export const PLATFORM_TEMPLATES: Record<string, Record<string, DomainField>> = {
  booksy: {
    'data wizyty': 'visit_at',
    'godzina rozpoczęcia': 'visit_at',
    klient: 'client_name',
    telefon: 'client_phone',
    usługa: 'service_name',
    pracownik: 'staff_name',
    cena: 'amount',
    'metoda płatności': 'payment_method',
    notatka: 'comment',
  },
  fresha: {
    'appointment date': 'visit_at',
    'start time': 'visit_at',
    client: 'client_name',
    'client phone': 'client_phone',
    service: 'service_name',
    'team member': 'staff_name',
    total: 'amount',
    'payment method': 'payment_method',
    note: 'comment',
  },
  // Treatwell: EN + основные локали (de/fr/it/nl). Все алиасы матчат точным
  // совпадением заголовка — лишние ключи безвредны.
  treatwell: {
    // English
    date: 'visit_at',
    time: 'visit_at',
    'customer name': 'client_name',
    'customer phone': 'client_phone',
    treatment: 'service_name',
    therapist: 'staff_name',
    price: 'amount',
    'paid by': 'payment_method',
    notes: 'comment',
    // Deutsch (connect.treatwell.de)
    datum: 'visit_at',
    uhrzeit: 'visit_at',
    kunde: 'client_name',
    kundenname: 'client_name',
    'telefon des kunden': 'client_phone',
    behandlung: 'service_name',
    mitarbeiter: 'staff_name',
    preis: 'amount',
    'bezahlt mit': 'payment_method',
    notiz: 'comment',
    bemerkung: 'comment',
    // Français
    heure: 'visit_at',
    'nom du client': 'client_name',
    'téléphone du client': 'client_phone',
    prestation: 'service_name',
    praticien: 'staff_name',
    prix: 'amount',
    'payé par': 'payment_method',
    // Italiano
    data: 'visit_at',
    ora: 'visit_at',
    cliente: 'client_name',
    trattamento: 'service_name',
    operatore: 'staff_name',
    prezzo: 'amount',
    // Nederlands
    tijd: 'visit_at',
    klant: 'client_name',
    behandeling: 'service_name',
    medewerker: 'staff_name',
    prijs: 'amount',
  },
}

/** Эвристика автомаппинга колонки по её заголовку (мультиязычная). */
export function guessField(header: string): DomainField {
  const h = header.toLowerCase().trim()
  // дата/время: en date/time, ru дата/время, pl godzina, de datum/uhrzeit/zeit,
  // fr heure, it data/ora, nl tijd
  if (/(date|time|время|дата|day|когда|godzina|datum|uhrzeit|zeit|heure|ora|tijd)/i.test(h))
    return 'visit_at'
  if (
    /(price|amount|sum|total|итого|сумма|стоимость|cena|kwota|preis|prix|prezzo|prijs|betrag|importo|montant)/i.test(
      h,
    )
  )
    return 'amount'
  if (/(phone|tel|телефон|номер|telefon|téléphone|telefono|telefoon|mobile|handy)/i.test(h))
    return 'client_phone'
  if (
    /(client|customer|клиент|имя|name|klient|kunde|cliente|klant|gast)/i.test(h) &&
    !/staff|master|мастер|pracownik|mitarbeiter|operatore|medewerker|praticien|therapist/i.test(h)
  )
    return 'client_name'
  if (
    /(staff|master|мастер|specialist|pracownik|therapist|team|mitarbeiter|operatore|medewerker|praticien|behandelaar)/i.test(
      h,
    )
  )
    return 'staff_name'
  if (
    /(service|услуга|product|treatment|usługa|behandlung|prestation|trattamento|behandeling|leistung)/i.test(
      h,
    )
  )
    return 'service_name'
  if (
    /(payment|paid|способ|оплата|method|płatnoś|zahlung|bezahlt|payé|paiement|pagamento|betaling|betaald)/i.test(
      h,
    )
  )
    return 'payment_method'
  if (
    /(comment|note|комментарий|примечание|notatka|notes|notiz|bemerkung|note|nota|notitie|opmerking)/i.test(
      h,
    )
  )
    return 'comment'
  return 'skip'
}

/**
 * Детектируем платформу: считаем сколько headers матчатся точным шаблоном.
 * Победитель с >=3 совпадениями применяет шаблон (+ guessField для остальных
 * колонок); иначе — generic guessField по всем колонкам.
 */
export function buildMapping(headers: string[]): Record<number, DomainField> {
  const lower = headers.map((h) => h.toLowerCase().trim())
  let best: { template: Record<string, DomainField> | null; score: number } = {
    template: null,
    score: 0,
  }
  for (const tpl of Object.values(PLATFORM_TEMPLATES)) {
    const score = lower.filter((h) => tpl[h]).length
    if (score > best.score) best = { template: tpl, score }
  }

  const m: Record<number, DomainField> = {}
  if (best.template && best.score >= 3) {
    headers.forEach((h, i) => {
      const exact = best.template![h.toLowerCase().trim()]
      m[i] = exact ?? guessField(h)
    })
  } else {
    headers.forEach((h, i) => {
      m[i] = guessField(h)
    })
  }
  return m
}
