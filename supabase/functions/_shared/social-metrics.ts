/**
 * Чистые helper'ы для парсинга социальных метрик из HTML публичных
 * страниц (Instagram / Facebook). Best-effort — без Meta Graph API.
 *
 * Чистые функции (без сетевых вызовов) — чтобы можно было тестировать
 * на фикстурах. Сами fetch-вызовы остаются в edge function.
 */

/** Парсит «1.2K» / «3M» / «1,234» / «1 234» → number. Возвращает 0 если не удалось. */
export function parseSocialCount(raw: string): number {
  // Удаляем разделители тысяч (запятая, пробел, неразрывный пробел, точка как разделитель тысяч).
  // Многоязычные форматы: "1,234" (EN), "1 234" (FR/PL), "1 234" (NBSP).
  const r = raw.trim().replace(/[,\s  ]/g, '')
  if (!r) return 0
  if (/[Kk]$/.test(r)) return Math.round(parseFloat(r) * 1_000)
  if (/[Mm]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000)
  if (/[Bb]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000_000)
  const n = parseFloat(r)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** Декодирует HTML entities (&#x105;, &#243;, &amp;) в обычные символы.
 *  Нужно для og:description, который Instagram/FB прогоняют через entity-encode. */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export type InstaCounts = {
  followers?: number
  posts?: number
  following?: number
}

/**
 * Парсит og:description Instagram. Поддерживает несколько локалей:
 *   - EN: "X Followers, Y Following, Z Posts — ..."
 *   - PL: "Obserwujący: X, obserwowani: Y posty: Z — ..."
 *   - DE: "X Abonnenten, Y abonniert, Z Beiträge ..."
 *   - RU: "X подписчиков, Y подписок, Z публикаций ..."
 *   - ES: "X seguidores, Y seguidos, Z publicaciones ..."
 *
 * Стратегия: декодируем HTML entities, потом два прохода — позиционный (3 числа)
 * и semantic (ключевые слова на разных языках).
 */
export function parseInstaOgDescription(html: string): InstaCounts {
  const og = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)
  if (!og || !og[1]) return {}
  const text = decodeHtmlEntities(og[1])
  const out: InstaCounts = {}

  // NUM требует начало с ЦИФРЫ (не точки), иначе захватываем ведущий dot из
  // предложения, и parseFloat трактует «. 129» как 0.129.
  const NUM = '(\\d[\\d.,\\s\\u00a0\\u202f]*(?:[KMB])?)'
  const tryMatch = (re: RegExp, key: keyof InstaCounts) => {
    if (out[key] != null) return
    const m = text.match(re)
    if (m && m[1]) {
      const v = parseSocialCount(m[1])
      if (v > 0) out[key] = v
    }
  }

  // Followers
  tryMatch(new RegExp(`${NUM}\\s*Followers`, 'i'), 'followers')
  tryMatch(new RegExp(`Obserwuj(?:ący|acy):\\s*${NUM}`, 'i'), 'followers')
  tryMatch(new RegExp(`${NUM}\\s*Abonnenten`, 'i'), 'followers')
  tryMatch(new RegExp(`${NUM}\\s*подписчик`, 'i'), 'followers')
  tryMatch(new RegExp(`${NUM}\\s*seguidores`, 'i'), 'followers')

  // Following — для RU нужно отличать «подписчиков» (followers) от «подписок»
  // (following): первое слово содержит подписк как префикс, поэтому
  // строго matches «подписок|подписки» (формы которые Instagram реально
  // использует), без `ч`. \b не работает для кириллицы в JS regex без флага u.
  tryMatch(new RegExp(`${NUM}\\s*Following`, 'i'), 'following')
  tryMatch(new RegExp(`obserwowani:\\s*${NUM}`, 'i'), 'following')
  tryMatch(new RegExp(`${NUM}\\s*abonniert`, 'i'), 'following')
  tryMatch(new RegExp(`${NUM}\\s*подпис(?:ок|ки|ке|кой)`, 'i'), 'following')
  tryMatch(new RegExp(`${NUM}\\s*seguidos`, 'i'), 'following')

  // Posts
  tryMatch(new RegExp(`${NUM}\\s*Posts`, 'i'), 'posts')
  tryMatch(new RegExp(`post(?:y|ów):\\s*${NUM}`, 'i'), 'posts')
  // PL: "...posty: 272 — zobacz..." — формат с двоеточием после
  tryMatch(new RegExp(`posty:?\\s*${NUM}`, 'i'), 'posts')
  tryMatch(new RegExp(`${NUM}\\s*Beiträge`, 'i'), 'posts')
  tryMatch(new RegExp(`${NUM}\\s*публикаци`, 'i'), 'posts')
  tryMatch(new RegExp(`${NUM}\\s*publicaciones`, 'i'), 'posts')

  return out
}

/**
 * Best-effort estimate частоты постов (posts_per_month) из HTML страницы.
 *
 * Стратегия:
 *   1. Найти все ISO-8601 datetime в HTML (атрибут datetime, og:updated_time,
 *      article:published_time, JSON-LD datePublished/uploadDate).
 *   2. Отсортировать по убыванию.
 *   3. Если найдено >= 2 дат — считаем средний интервал между ними и
 *      экстраполируем до month (30 дней).
 *   4. Если найдена только 1 дата (например, og:updated_time) — пробуем
 *      оценить по соотношению (posts / months_since_min_date) если posts задан.
 *
 * Возвращает null если оценить невозможно.
 *
 * Это эвристика — точность плавающая. Без Meta Graph API нет надёжного способа.
 */
export function estimatePostsPerMonth(html: string, totalPosts?: number): number | null {
  const isoMatches = html.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g,
  )
  const epochMatches = html.match(/"taken_at(?:_timestamp)?":\s*(\d{9,10})/g)
  const dates: number[] = []
  if (isoMatches) {
    for (const m of isoMatches) {
      const t = Date.parse(m)
      if (Number.isFinite(t)) dates.push(t)
    }
  }
  if (epochMatches) {
    for (const m of epochMatches) {
      const num = m.match(/(\d{9,10})/)
      if (num && num[1]) {
        const ts = parseInt(num[1], 10) * 1000
        if (Number.isFinite(ts)) dates.push(ts)
      }
    }
  }
  // Уникальные + сортировка по убыванию.
  const unique = Array.from(new Set(dates)).sort((a, b) => b - a)
  const now = Date.now()
  // Фильтруем явный мусор: даты из будущего и старше 5 лет.
  const fiveYearsAgo = now - 5 * 365 * 24 * 3600 * 1000
  const filtered = unique.filter((d) => d <= now && d >= fiveYearsAgo)

  // Вариант 1: 2+ даты — считаем средний интервал.
  if (filtered.length >= 2) {
    const newest = filtered[0]!
    const oldest = filtered[filtered.length - 1]!
    const spanDays = (newest - oldest) / (24 * 3600 * 1000)
    if (spanDays <= 0) return null
    const postsPerDay = (filtered.length - 1) / spanDays
    const perMonth = postsPerDay * 30
    if (!Number.isFinite(perMonth) || perMonth <= 0) return null
    // Округление до 1 знака после запятой.
    return Math.round(perMonth * 10) / 10
  }

  // Вариант 2: 1 дата + известное totalPosts — экстраполируем "посты с момента
  // создания". Это очень грубая оценка (используем дату как создание аккаунта),
  // годится только когда вариант 1 невозможен.
  if (filtered.length === 1 && totalPosts && totalPosts > 0) {
    const accountAgeDays = (now - filtered[0]!) / (24 * 3600 * 1000)
    if (accountAgeDays < 30) return null
    const perMonth = (totalPosts * 30) / accountAgeDays
    if (!Number.isFinite(perMonth) || perMonth <= 0) return null
    return Math.round(perMonth * 10) / 10
  }

  return null
}

/**
 * Парсит "likes" с публичной FB-страницы.
 * FB разный HTML: "12,345 people like this", "1.2K likes",
 *   "129 osób lubi to", "Lubi to: 1234 osoby", "Polubienia: 1234".
 * Сначала декодируем HTML entities (Facebook их вставляет: «osób» → «os&#xf3;b»).
 */
export function parseFbLikes(html: string): number | null {
  // Декодируем только релевантную часть (og:description обычно содержит likes).
  // Если og:description не найден — fallback на весь HTML.
  const og = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)
  const haystack = og && og[1] ? decodeHtmlEntities(og[1]) : decodeHtmlEntities(html)

  const NUM = '(\\d[\\d.,\\s\\u00a0\\u202f]*(?:[KMB])?)'
  const patterns = [
    new RegExp(`${NUM}\\s*people\\s+like`, 'i'),
    new RegExp(`${NUM}\\s*likes?\\b`, 'i'),
    new RegExp(`${NUM}\\s*like\\s+this`, 'i'),
    // Polish: «129 osób lubi to» / «1 234 osoby lubią to» / «Lubi to: 129 osób»
    new RegExp(`${NUM}\\s*os[oó]b\\s+lubi`, 'i'),
    new RegExp(`${NUM}\\s*osoby\\s+lubi`, 'i'),
    new RegExp(`Lubi\\s+to:?\\s*${NUM}`, 'i'),
    new RegExp(`Polubieni[ae]:?\\s*${NUM}`, 'i'),
    // Russian: «X отметок «Нравится»», «Нравится: X»
    new RegExp(`${NUM}\\s*отмет[ао]к`, 'i'),
    new RegExp(`Нравится:?\\s*${NUM}`, 'i'),
    // German: "X Personen gefällt das"
    new RegExp(`${NUM}\\s*Personen\\s+gef[äa]llt`, 'i'),
    // Spanish: "A X personas les gusta esto"
    new RegExp(`${NUM}\\s*personas?\\s+les\\s+gusta`, 'i'),
  ]

  for (const re of patterns) {
    const m = haystack.match(re)
    if (m && m[1]) {
      const v = parseSocialCount(m[1])
      if (v > 0) return v
    }
  }
  return null
}
