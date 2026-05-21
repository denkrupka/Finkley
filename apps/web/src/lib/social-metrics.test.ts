/**
 * Shadow-тесты для supabase/functions/_shared/social-metrics.ts.
 *
 * Реальный модуль импортирует из Deno (https://esm.sh/...), который не
 * работает в vitest. Поэтому дублируем чистые helper'ы 1:1 и проверяем
 * парсинг социальных метрик на синтетических HTML-фикстурах.
 *
 * Если меняешь логику в supabase/functions/_shared/social-metrics.ts —
 * синхронизируй здесь.
 */
import { describe, expect, it } from 'vitest'

function parseSocialCount(raw: string): number {
  const r = raw.trim().replace(/,/g, '')
  if (!r) return 0
  if (/[Kk]$/.test(r)) return Math.round(parseFloat(r) * 1_000)
  if (/[Mm]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000)
  if (/[Bb]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000_000)
  const n = parseFloat(r)
  return Number.isFinite(n) ? Math.round(n) : 0
}

type InstaCounts = {
  followers?: number
  posts?: number
  following?: number
}

function parseInstaOgDescription(html: string): InstaCounts {
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

function estimatePostsPerMonth(html: string, totalPosts?: number): number | null {
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
  const unique = Array.from(new Set(dates)).sort((a, b) => b - a)
  const now = Date.now()
  const fiveYearsAgo = now - 5 * 365 * 24 * 3600 * 1000
  const filtered = unique.filter((d) => d <= now && d >= fiveYearsAgo)

  if (filtered.length >= 2) {
    const newest = filtered[0]!
    const oldest = filtered[filtered.length - 1]!
    const spanDays = (newest - oldest) / (24 * 3600 * 1000)
    if (spanDays <= 0) return null
    const postsPerDay = (filtered.length - 1) / spanDays
    const perMonth = postsPerDay * 30
    if (!Number.isFinite(perMonth) || perMonth <= 0) return null
    return Math.round(perMonth * 10) / 10
  }

  if (filtered.length === 1 && totalPosts && totalPosts > 0) {
    const accountAgeDays = (now - filtered[0]!) / (24 * 3600 * 1000)
    if (accountAgeDays < 30) return null
    const perMonth = (totalPosts * 30) / accountAgeDays
    if (!Number.isFinite(perMonth) || perMonth <= 0) return null
    return Math.round(perMonth * 10) / 10
  }

  return null
}

function parseFbLikes(html: string): number | null {
  const m = html.match(/([\d,]+(?:\.\d+)?[KMB]?)\s*(?:people\s+like|likes|like\s+this)/i)
  if (m && m[1]) return parseSocialCount(m[1])
  return null
}

describe('parseSocialCount', () => {
  it('plain numbers', () => {
    expect(parseSocialCount('100')).toBe(100)
    expect(parseSocialCount('1,234')).toBe(1234)
    expect(parseSocialCount('  42  ')).toBe(42)
  })

  it('K suffix → thousands', () => {
    expect(parseSocialCount('1K')).toBe(1000)
    expect(parseSocialCount('1.2K')).toBe(1200)
    expect(parseSocialCount('5k')).toBe(5000)
  })

  it('M suffix → millions', () => {
    expect(parseSocialCount('1M')).toBe(1_000_000)
    expect(parseSocialCount('2.5M')).toBe(2_500_000)
  })

  it('B suffix → billions', () => {
    expect(parseSocialCount('1B')).toBe(1_000_000_000)
    expect(parseSocialCount('1.5b')).toBe(1_500_000_000)
  })

  it('garbage → 0', () => {
    expect(parseSocialCount('')).toBe(0)
    expect(parseSocialCount('abc')).toBe(0)
    expect(parseSocialCount('---')).toBe(0)
  })
})

describe('parseInstaOgDescription', () => {
  it('extracts followers/posts/following counts', () => {
    const html =
      '<meta property="og:description" content="12.5K Followers, 543 Following, 1,234 Posts - Welcome to my salon">'
    const r = parseInstaOgDescription(html)
    expect(r.followers).toBe(12_500)
    expect(r.following).toBe(543)
    expect(r.posts).toBe(1234)
  })

  it('handles missing meta tag', () => {
    expect(parseInstaOgDescription('<html></html>')).toEqual({})
  })

  it('partial fields', () => {
    const html = '<meta property="og:description" content="2M Followers - private profile">'
    const r = parseInstaOgDescription(html)
    expect(r.followers).toBe(2_000_000)
    expect(r.posts).toBeUndefined()
    expect(r.following).toBeUndefined()
  })

  it('case-insensitive keywords', () => {
    const html = '<meta property="og:description" content="100 followers, 50 following, 30 posts">'
    const r = parseInstaOgDescription(html)
    expect(r.followers).toBe(100)
    expect(r.following).toBe(50)
    expect(r.posts).toBe(30)
  })
})

describe('estimatePostsPerMonth', () => {
  it('2 ISO dates ровно через 30 дней → 1 post / month (1 интервал)', () => {
    const newest = '2026-05-01T12:00:00Z'
    const oldest = '2026-04-01T12:00:00Z'
    const html = `<time datetime="${newest}"></time><time datetime="${oldest}"></time>`
    // 1 интервал в 30 дней = (2-1)/30 * 30 = 1 post/month.
    expect(estimatePostsPerMonth(html)).toBe(1)
  })

  it('10 дат с шагом 3 дня (span 27д) → 9 интервалов / 27д * 30 = 10/мес', () => {
    const base = new Date('2026-05-01T12:00:00Z').getTime()
    const dates = Array.from({ length: 10 }, (_, i) =>
      new Date(base - i * 3 * 24 * 3600 * 1000).toISOString(),
    )
    const html = dates.map((d) => `<time datetime="${d}"></time>`).join('')
    const ppm = estimatePostsPerMonth(html)
    expect(ppm).not.toBeNull()
    expect(ppm!).toBeGreaterThan(9)
    expect(ppm!).toBeLessThan(11)
  })

  it('1 date + totalPosts → грубая оценка по возрасту аккаунта', () => {
    // Дата год назад + 120 постов → ~10 в месяц.
    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()
    const html = `<meta property="og:updated_time" content="${yearAgo}">`
    const ppm = estimatePostsPerMonth(html, 120)
    expect(ppm).not.toBeNull()
    expect(ppm!).toBeGreaterThan(8)
    expect(ppm!).toBeLessThan(12)
  })

  it('1 date < 30 дней → null (слишком короткий интервал)', () => {
    const recent = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    const html = `<meta property="og:updated_time" content="${recent}">`
    expect(estimatePostsPerMonth(html, 50)).toBeNull()
  })

  it('даты из будущего фильтруются', () => {
    const future1 = '2099-01-01T00:00:00Z'
    const future2 = '2099-02-01T00:00:00Z'
    const html = `<time datetime="${future1}"></time><time datetime="${future2}"></time>`
    expect(estimatePostsPerMonth(html)).toBeNull()
  })

  it('даты старше 5 лет фильтруются', () => {
    const old1 = '2010-01-01T00:00:00Z'
    const old2 = '2010-02-01T00:00:00Z'
    const html = `<time datetime="${old1}"></time><time datetime="${old2}"></time>`
    expect(estimatePostsPerMonth(html)).toBeNull()
  })

  it('taken_at_timestamp (Instagram-style numeric) тоже работает', () => {
    const t1 = Math.floor((Date.now() - 5 * 24 * 3600 * 1000) / 1000)
    const t2 = Math.floor((Date.now() - 15 * 24 * 3600 * 1000) / 1000)
    const html = `{"taken_at_timestamp":${t1}},{"taken_at_timestamp":${t2}}`
    const ppm = estimatePostsPerMonth(html)
    expect(ppm).not.toBeNull()
    expect(ppm!).toBeGreaterThan(0)
  })

  it('пустой HTML → null', () => {
    expect(estimatePostsPerMonth('')).toBeNull()
    expect(estimatePostsPerMonth('<html><body>no dates here</body></html>')).toBeNull()
  })

  it('дубли дат не считаются как отдельные посты', () => {
    const d = '2026-05-01T12:00:00Z'
    const html = `<time datetime="${d}"></time><time datetime="${d}"></time>`
    expect(estimatePostsPerMonth(html)).toBeNull()
  })
})

describe('parseFbLikes', () => {
  it('"X people like this"', () => {
    expect(parseFbLikes('<div>12,345 people like this</div>')).toBe(12_345)
  })

  it('"X likes"', () => {
    expect(parseFbLikes('1.5K likes')).toBe(1500)
  })

  it('"like this" variant', () => {
    expect(parseFbLikes('500 like this page')).toBe(500)
  })

  it('null when no match', () => {
    expect(parseFbLikes('<html></html>')).toBeNull()
  })
})
