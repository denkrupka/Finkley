/**
 * Тесты для логики сортировки/фильтрации в ReviewsTab.
 *
 * В UI это всё инлайн в useMemo, но логика стоящая отдельных тестов.
 * Дублируем функцию сортировки 1:1 — sorted-helper тестируется без
 * необходимости рендера компонента.
 */
import { describe, expect, it } from 'vitest'

type ReviewSort = 'newest' | 'oldest' | 'rating_asc' | 'rating_desc'

type Review = {
  id: string
  rating: number | null
  posted_at: string
  body: string | null
  author_name: string | null
  source: 'internal' | 'booksy' | 'google'
}

function sortReviews(rows: Review[], sort: ReviewSort): Review[] {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    if (sort === 'newest') return b.posted_at.localeCompare(a.posted_at)
    if (sort === 'oldest') return a.posted_at.localeCompare(b.posted_at)
    if (sort === 'rating_asc') return (a.rating ?? 0) - (b.rating ?? 0)
    return (b.rating ?? 0) - (a.rating ?? 0)
  })
  return sorted
}

function filterReviews(rows: Review[], sub: 'external' | 'internal', search: string): Review[] {
  let r = rows
  if (sub === 'external') r = r.filter((x) => x.source !== 'internal')
  else r = r.filter((x) => x.source === 'internal')
  const q = search.trim().toLowerCase()
  if (q) {
    r = r.filter(
      (x) =>
        (x.body ?? '').toLowerCase().includes(q) || (x.author_name ?? '').toLowerCase().includes(q),
    )
  }
  return r
}

const sample: Review[] = [
  {
    id: '1',
    rating: 5,
    posted_at: '2026-05-01T10:00:00Z',
    body: 'great service',
    author_name: 'Anna',
    source: 'google',
  },
  {
    id: '2',
    rating: 2,
    posted_at: '2026-05-15T10:00:00Z',
    body: 'long wait',
    author_name: 'Bob',
    source: 'internal',
  },
  {
    id: '3',
    rating: null,
    posted_at: '2026-05-10T10:00:00Z',
    body: null,
    author_name: 'Charlie',
    source: 'booksy',
  },
  {
    id: '4',
    rating: 4,
    posted_at: '2026-05-05T10:00:00Z',
    body: 'professional masters',
    author_name: null,
    source: 'google',
  },
]

describe('sortReviews', () => {
  it('newest first', () => {
    const ids = sortReviews(sample, 'newest').map((r) => r.id)
    expect(ids).toEqual(['2', '3', '4', '1'])
  })

  it('oldest first', () => {
    const ids = sortReviews(sample, 'oldest').map((r) => r.id)
    expect(ids).toEqual(['1', '4', '3', '2'])
  })

  it('rating_asc — null treated as 0 (so listed first)', () => {
    const ids = sortReviews(sample, 'rating_asc').map((r) => r.id)
    expect(ids[0]).toBe('3') // rating=null → 0
    expect(ids[ids.length - 1]).toBe('1') // 5★ last
  })

  it('rating_desc — 5 first, null last', () => {
    const ids = sortReviews(sample, 'rating_desc').map((r) => r.id)
    expect(ids[0]).toBe('1') // 5
    expect(ids[ids.length - 1]).toBe('3') // null=0
  })

  it("doesn't mutate original array", () => {
    const original = [...sample]
    sortReviews(sample, 'newest')
    expect(sample).toEqual(original)
  })
})

describe('filterReviews', () => {
  it('external = non-internal', () => {
    const r = filterReviews(sample, 'external', '')
    expect(r.map((x) => x.source).sort()).toEqual(['booksy', 'google', 'google'])
  })

  it('internal = only internal source', () => {
    const r = filterReviews(sample, 'internal', '')
    expect(r).toHaveLength(1)
    expect(r[0]!.id).toBe('2')
  })

  it('search by body text (case-insensitive)', () => {
    const r = filterReviews(sample, 'external', 'WAIT')
    // bob (id=2) is internal, his "long wait" не входит в external.
    expect(r).toHaveLength(0)
    const r2 = filterReviews(sample, 'external', 'professional')
    expect(r2).toHaveLength(1)
    expect(r2[0]!.id).toBe('4')
  })

  it('search by author name', () => {
    const r = filterReviews(sample, 'external', 'anna')
    expect(r).toHaveLength(1)
    expect(r[0]!.id).toBe('1')
  })

  it('empty search returns full subset', () => {
    expect(filterReviews(sample, 'external', '   ')).toHaveLength(3)
  })

  it('null body or author_name не падает', () => {
    const r = filterReviews(sample, 'external', 'charlie')
    expect(r).toHaveLength(1)
    expect(r[0]!.id).toBe('3') // body=null, но author_name="Charlie"
  })
})
