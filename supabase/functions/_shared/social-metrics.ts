/**
 * Чистые helper'ы для парсинга социальных метрик из HTML публичных
 * страниц (Instagram / Facebook). Best-effort — без Meta Graph API.
 *
 * Чистые функции (без сетевых вызовов) — чтобы можно было тестировать
 * на фикстурах. Сами fetch-вызовы остаются в edge function.
 */

/** Парсит «1.2K» / «3M» / «1,234» → number. Возвращает 0 если не удалось. */
export function parseSocialCount(raw: string): number {
  const r = raw.trim().replace(/,/g, '')
  if (!r) return 0
  if (/[Kk]$/.test(r)) return Math.round(parseFloat(r) * 1_000)
  if (/[Mm]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000)
  if (/[Bb]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000_000)
  const n = parseFloat(r)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export type InstaCounts = {
  followers?: number
  posts?: number
  following?: number
}

/**
 * Парсит og:description Instagram: "X Followers, Y Following, Z Posts — ..."
 * (формат немного различается по локалям, но числа + ключевые слова стабильны).
 */
export function parseInstaOgDescription(html: string): InstaCounts {
  const og = html.match(/<meta property="og:description" content="([^"]+)"/)
  if (!og || !og[1]) return {}
  const text = og[1]
  const followers = text.match(/([\d,]+(?:\.\d+)?[KMB]?)\s*Followers/i)
  const posts = text.match(/([\d,]+(?:\.\d+)?[KMB]?)\s*Posts/i)
  const following = text.match(/([\d,]+(?:\.\d+)?[KMB]?)\s*Following/i)
  const out: InstaCounts = {}
  if (followers && followers[1]) out.followers = parseSocialCount(followers[1])
  if (posts && posts[1]) out.posts = parseSocialCount(posts[1])
  if (following && following[1]) out.following = parseSocialCount(following[1])
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
 * FB разный HTML: "12,345 people like this", "1.2K likes", "Lubi to: 1234 osoby"…
 * Берём самый частый паттерн.
 */
export function parseFbLikes(html: string): number | null {
  const m = html.match(/([\d,]+(?:\.\d+)?[KMB]?)\s*(?:people\s+like|likes|like\s+this)/i)
  if (m && m[1]) return parseSocialCount(m[1])
  return null
}
