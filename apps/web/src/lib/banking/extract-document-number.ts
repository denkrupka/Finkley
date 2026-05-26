/**
 * Эвристика для распознавания номера документа (фактуры) в банковской
 * выписке. Польские банки чаще всего кладут tytuł платежа в `description`:
 *   "Wezwanie: P.KK.WDZ.P/04/26/5938424/0001 . Nr Klienta 5938424"
 *   "FV/2026/05/123 za usługi"
 *   "Faktura nr 123/2026 od ZUS"
 *
 * Берём первый «slash-токен с буквами» длиной ≥ 5 символов. Это покрывает
 * большинство польских форматов:
 *   FV/2026/05/123, P.KK.WDZ.P/04/26/5938424/0001, INV-2026-001, итд.
 * Чистые даты (01/02/2026) НЕ матчатся — требуем хотя бы одну букву.
 *
 * Если ничего не нашли — возвращаем null (юзер сам впишет вручную).
 */
export function extractDocumentNumber(description: string | null | undefined): string | null {
  if (!description) return null
  const text = description.trim()
  if (!text) return null

  // Pattern 1: slash- или dot-separated с буквами и цифрами
  // Например: FV/2026/05/123 или P.KK.WDZ.P/04/26/5938424/0001
  const slashed = text.match(/\b[A-Za-z][\w.]*\/[\w./]+\b/)
  if (slashed && slashed[0].length >= 5) {
    // Чистим хвостовые точки (Wezwanie: ... .)
    return slashed[0].replace(/[.,;:]+$/, '')
  }

  // Pattern 2: «Faktura nr 123/2026», «Nr dok. 456»
  const named = text.match(
    /(?:faktura|fakturę|fakturze|nr\s+dok\.?|invoice)[\s.]*(?:nr\s*)?[:#]?\s*([\w./-]{3,})/i,
  )
  if (named && named[1]) {
    return named[1].replace(/[.,;:]+$/, '')
  }

  // Pattern 3: «INV-2026-001» / «FV-001-2026» dash-style
  const dashed = text.match(/\b[A-Z]{2,}[-_][\w-]+\b/)
  if (dashed && dashed[0].length >= 5) {
    return dashed[0]
  }

  return null
}

/**
 * Грубое fuzzy-сравнение названий контрагентов (для авто-resolve в форме
 * расхода из bank-tx).
 *
 * Сравниваем нормализованные строки: lowercase, без spz / sp z o.o. /
 * других правовых суффиксов, без пробелов.
 *
 * candidate "myOrlen sp z oo"           → "myorlen"
 * counterparty.name "MyOrlen Sp. z o.o." → "myorlen"
 * → match.
 */
export function normalizeCounterpartyName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/\bsp(ó|o)łka\b/gi, '')
      // "sp. z o.o." / "sp z oo" — полная форма
      .replace(/\bs\.?\s*p\.?\s*z\.?\s*o\.?\s*o\.?/gi, '')
      .replace(/\bsp\s*z\s*o\.?o\.?/gi, '')
      // Остаток «z o.o.» после удаления spółka — тоже выкидываем
      .replace(/\bz\s*o\.?\s*o\.?/gi, '')
      // S.A. / SA — польская spółka akcyjna
      .replace(/\bs\.?\s*a\.?(?=\s|$|\W)/gi, '')
      .replace(/[\s.,]+/g, '')
      .trim()
  )
}

export function findMatchingCounterpartyId(
  bankCounterparty: string | null | undefined,
  counterparties: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  if (!bankCounterparty) return null
  const needle = normalizeCounterpartyName(bankCounterparty)
  if (!needle) return null
  for (const c of counterparties) {
    if (normalizeCounterpartyName(c.name) === needle) return c.id
  }
  // Substring fallback — counterparty.name содержит bank-имя или наоборот
  for (const c of counterparties) {
    const cname = normalizeCounterpartyName(c.name)
    if (cname && (cname.includes(needle) || needle.includes(cname))) return c.id
  }
  return null
}
