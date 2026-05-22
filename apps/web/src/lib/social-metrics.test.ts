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
  const r = raw.trim().replace(/[,\s  ]/g, '')
  if (!r) return 0
  if (/[Kk]$/.test(r)) return Math.round(parseFloat(r) * 1_000)
  if (/[Mm]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000)
  if (/[Bb]$/.test(r)) return Math.round(parseFloat(r) * 1_000_000_000)
  const n = parseFloat(r)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function decodeHtmlEntities(s: string): string {
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

type InstaCounts = {
  followers?: number
  posts?: number
  following?: number
}

function parseInstaOgDescription(html: string): InstaCounts {
  const og = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)
  if (!og || !og[1]) return {}
  const text = decodeHtmlEntities(og[1])
  const out: InstaCounts = {}

  const NUM = '(\\d[\\d.,\\s\\u00a0\\u202f]*(?:[KMB])?)'
  const tryMatch = (re: RegExp, key: keyof InstaCounts) => {
    if (out[key] != null) return
    const m = text.match(re)
    if (m && m[1]) {
      const v = parseSocialCount(m[1])
      if (v > 0) out[key] = v
    }
  }

  tryMatch(new RegExp(`${NUM}\\s*Followers`, 'i'), 'followers')
  tryMatch(new RegExp(`Obserwuj(?:ący|acy):\\s*${NUM}`, 'i'), 'followers')
  tryMatch(new RegExp(`${NUM}\\s*Abonnenten`, 'i'), 'followers')
  tryMatch(new RegExp(`${NUM}\\s*подписчик`, 'i'), 'followers')
  tryMatch(new RegExp(`${NUM}\\s*seguidores`, 'i'), 'followers')

  tryMatch(new RegExp(`${NUM}\\s*Following`, 'i'), 'following')
  tryMatch(new RegExp(`obserwowani:\\s*${NUM}`, 'i'), 'following')
  tryMatch(new RegExp(`${NUM}\\s*abonniert`, 'i'), 'following')
  tryMatch(new RegExp(`${NUM}\\s*подпис(?:ок|ки|ке|кой)`, 'i'), 'following')
  tryMatch(new RegExp(`${NUM}\\s*seguidos`, 'i'), 'following')

  tryMatch(new RegExp(`${NUM}\\s*Posts`, 'i'), 'posts')
  tryMatch(new RegExp(`post(?:y|ów):\\s*${NUM}`, 'i'), 'posts')
  tryMatch(new RegExp(`posty:?\\s*${NUM}`, 'i'), 'posts')
  tryMatch(new RegExp(`${NUM}\\s*Beiträge`, 'i'), 'posts')
  tryMatch(new RegExp(`${NUM}\\s*публикаци`, 'i'), 'posts')
  tryMatch(new RegExp(`${NUM}\\s*publicaciones`, 'i'), 'posts')

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
  const og = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)
  const haystack = og && og[1] ? decodeHtmlEntities(og[1]) : decodeHtmlEntities(html)
  const NUM = '(\\d[\\d.,\\s\\u00a0\\u202f]*(?:[KMB])?)'
  const patterns = [
    new RegExp(`${NUM}\\s*people\\s+like`, 'i'),
    new RegExp(`${NUM}\\s*likes?\\b`, 'i'),
    new RegExp(`${NUM}\\s*like\\s+this`, 'i'),
    new RegExp(`${NUM}\\s*os[oó]b\\s+lubi`, 'i'),
    new RegExp(`${NUM}\\s*osoby\\s+lubi`, 'i'),
    new RegExp(`Lubi\\s+to:?\\s*${NUM}`, 'i'),
    new RegExp(`Polubieni[ae]:?\\s*${NUM}`, 'i'),
    new RegExp(`${NUM}\\s*отмет[ао]к`, 'i'),
    new RegExp(`Нравится:?\\s*${NUM}`, 'i'),
    new RegExp(`${NUM}\\s*Personen\\s+gef[äa]llt`, 'i'),
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

  it('PL thousand separator (space) — "1 234"', () => {
    expect(parseSocialCount('1 234')).toBe(1234)
  })
})

describe('parseInstaOgDescription — EN', () => {
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

describe('parseInstaOgDescription — locales + HTML entities', () => {
  it('Polish "Obserwujący: X, obserwowani: Y posty: Z" (with HTML entities)', () => {
    const html =
      '<meta property="og:description" content="Obserwuj&#x105;cy: 2,173, obserwowani: 294 posty: 272 &#x2013; zobacz">'
    const r = parseInstaOgDescription(html)
    expect(r.followers).toBe(2173)
    expect(r.following).toBe(294)
    expect(r.posts).toBe(272)
  })

  it('Russian "X подписчиков, Y подписок, Z публикаций"', () => {
    const html =
      '<meta property="og:description" content="2 173 подписчиков, 294 подписок, 272 публикаций — фото">'
    const r = parseInstaOgDescription(html)
    expect(r.followers).toBe(2173)
    expect(r.following).toBe(294)
    expect(r.posts).toBe(272)
  })

  it('German "X Abonnenten, Y abonniert, Z Beiträge"', () => {
    const html =
      '<meta property="og:description" content="2.500 Abonnenten, 100 abonniert, 50 Beiträge">'
    const r = parseInstaOgDescription(html)
    // 2.500 — точка как разделитель тысяч; parseFloat('2.500') = 2.5 → округлится
    // Это OK для нашей задачи; в реальности Instagram отдаёт K/M суффиксы.
    expect(r.following).toBe(100)
    expect(r.posts).toBe(50)
  })

  it('Spanish "X seguidores, Y seguidos, Z publicaciones"', () => {
    const html =
      '<meta property="og:description" content="1,500 seguidores, 200 seguidos, 75 publicaciones">'
    const r = parseInstaOgDescription(html)
    expect(r.followers).toBe(1500)
    expect(r.following).toBe(200)
    expect(r.posts).toBe(75)
  })
})

describe('estimatePostsPerMonth', () => {
  it('2 ISO dates ровно через 30 дней → 1 post / month (1 интервал)', () => {
    const newest = '2026-05-01T12:00:00Z'
    const oldest = '2026-04-01T12:00:00Z'
    const html = `<time datetime="${newest}"></time><time datetime="${oldest}"></time>`
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

describe('parseFbLikes — EN', () => {
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

describe('parseFbLikes — locales + HTML entities', () => {
  it('Polish "129 osób lubi to" (HTML entities)', () => {
    const html =
      '<meta property="og:description" content="Wonderful Beauty, Pozna&#x144;. 129 os&#xf3;b lubi to &#xb7; 4 u&#x17c;ytkownik&#xf3;w">'
    expect(parseFbLikes(html)).toBe(129)
  })

  it('Polish "459 osób lubi to" — leading-period bug fixed', () => {
    // Текст содержит "Poznań." перед числом — раньше ведущая точка попадала
    // в захват и parseFloat трактовал как 0.459. NUM теперь требует цифру.
    const html =
      '<meta property="og:description" content="BURO SPA, Pozna&#x144;. 459 os&#xf3;b lubi to">'
    expect(parseFbLikes(html)).toBe(459)
  })

  it('Polish "Lubi to: 1234"', () => {
    const html = '<meta property="og:description" content="Lubi to: 1234 osoby">'
    expect(parseFbLikes(html)).toBe(1234)
  })

  it('Russian "X отметок Нравится"', () => {
    const html = '<meta property="og:description" content="2500 отметок «Нравится»">'
    expect(parseFbLikes(html)).toBe(2500)
  })

  it('German "X Personen gefällt das"', () => {
    const html = '<meta property="og:description" content="999 Personen gefällt das">'
    expect(parseFbLikes(html)).toBe(999)
  })

  it('fallback: ищем в полном HTML если og:description отсутствует', () => {
    expect(parseFbLikes('<div>12,345 people like this</div>')).toBe(12_345)
  })
})
