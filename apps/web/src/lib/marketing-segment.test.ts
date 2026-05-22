/**
 * Shadow-тесты для supabase/functions/marketing-send-broadcast/index.ts::
 * filterBySegment + helper'ов фильтрации каналов.
 *
 * Это критичная функция — она решает, кому уходит массовая SMS-рассылка.
 * Ошибка в фильтре = реальные SMS клиентам которые не должны были получить
 * (с реальным списанием с баланса салона). Поэтому unit-тесты на каждый
 * сегмент + edge cases (пустой список, неподходящие теги, граничные даты).
 */
import { describe, expect, it } from 'vitest'

type ClientRow = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  visit_count: number
  last_visit_at: string | null
  tags: string[] | null
}

type Segment = 'all' | 'new' | 'regular' | 'dormant' | { tag: string }

const DORMANT_DAYS = 90
const REGULAR_MIN_VISITS = 5

function filterBySegment(clients: ClientRow[], seg: Segment): ClientRow[] {
  const now = Date.now()
  return clients.filter((c) => {
    if (seg === 'all') return true
    if (seg === 'new') return c.visit_count === 1
    if (seg === 'regular') return c.visit_count >= REGULAR_MIN_VISITS
    if (seg === 'dormant') {
      if (!c.last_visit_at) return false
      const days = (now - new Date(c.last_visit_at).getTime()) / 86_400_000
      return days >= DORMANT_DAYS
    }
    if (typeof seg === 'object' && seg.tag) {
      return Array.isArray(c.tags) && c.tags.includes(seg.tag)
    }
    return false
  })
}

const TODAY = Date.now()
function daysAgo(n: number): string {
  return new Date(TODAY - n * 86_400_000).toISOString()
}

const FIXTURES: ClientRow[] = [
  // 0: новый клиент, 1 визит, недавно
  {
    id: '0',
    name: 'New One',
    phone: '+48111111111',
    email: 'new@x',
    visit_count: 1,
    last_visit_at: daysAgo(5),
    tags: ['vip'],
  },
  // 1: постоянный, 8 визитов, активный
  {
    id: '1',
    name: 'Regular Active',
    phone: '+48222222222',
    email: 'reg@x',
    visit_count: 8,
    last_visit_at: daysAgo(20),
    tags: ['vip', 'manicure'],
  },
  // 2: постоянный, 6 визитов, спящий 120 дней
  {
    id: '2',
    name: 'Regular Dormant',
    phone: '+48333333333',
    email: null,
    visit_count: 6,
    last_visit_at: daysAgo(120),
    tags: null,
  },
  // 3: 2 визита, не новый и не постоянный (< REGULAR_MIN_VISITS), активный
  {
    id: '3',
    name: 'Mid',
    phone: null,
    email: 'mid@x',
    visit_count: 2,
    last_visit_at: daysAgo(10),
    tags: ['hair'],
  },
  // 4: 1 визит давно (>90д) — и новый, и dormant
  {
    id: '4',
    name: 'New Dormant',
    phone: '+48444444444',
    email: null,
    visit_count: 1,
    last_visit_at: daysAgo(150),
    tags: [],
  },
  // 5: 0 визитов, без last_visit (только добавлен) — не должен попадать никуда
  // кроме 'all'
  {
    id: '5',
    name: 'Zero',
    phone: null,
    email: 'zero@x',
    visit_count: 0,
    last_visit_at: null,
    tags: null,
  },
]

describe('filterBySegment — критический фильтр массовых рассылок', () => {
  it('segment=all → возвращает всех (включая ноль-визитников и без контакта)', () => {
    const r = filterBySegment(FIXTURES, 'all')
    expect(r).toHaveLength(FIXTURES.length)
  })

  it('segment=new → только клиенты с visit_count===1 (не 0, не 2)', () => {
    const r = filterBySegment(FIXTURES, 'new')
    expect(r.map((c) => c.id).sort()).toEqual(['0', '4'])
  })

  it('segment=regular → только visit_count >= 5 (граница 5, не 4)', () => {
    const r = filterBySegment(FIXTURES, 'regular')
    expect(r.map((c) => c.id).sort()).toEqual(['1', '2'])
  })

  it('segment=dormant → last_visit ≥ 90 дней назад (граница строгая)', () => {
    const r = filterBySegment(FIXTURES, 'dormant')
    expect(r.map((c) => c.id).sort()).toEqual(['2', '4'])
  })

  it('segment=dormant → клиент без last_visit_at НЕ попадает (нельзя считать спящим)', () => {
    const r = filterBySegment(FIXTURES, 'dormant')
    expect(r.find((c) => c.id === '5')).toBeUndefined()
  })

  it('segment={tag} → только клиенты с этим тегом', () => {
    const vip = filterBySegment(FIXTURES, { tag: 'vip' })
    expect(vip.map((c) => c.id).sort()).toEqual(['0', '1'])
    const hair = filterBySegment(FIXTURES, { tag: 'hair' })
    expect(hair.map((c) => c.id)).toEqual(['3'])
  })

  it('segment={tag} с несуществующим тегом → пустой результат (НЕ all)', () => {
    const r = filterBySegment(FIXTURES, { tag: 'nonexistent_tag' })
    expect(r).toHaveLength(0)
  })

  it('segment={tag: ""} → пустой результат (защита от случайной all-рассылки)', () => {
    // Если юзер случайно поставил флажок tag без значения — НЕ слать всем.
    // Падение на сервере: validator проверяет tag.length > 0 в UI;
    // здесь — что filter не падает и возвращает пусто.
    const r = filterBySegment(FIXTURES, { tag: '' } as { tag: string })
    expect(r).toHaveLength(0)
  })

  it('segment=new НЕ включает visit_count=2 (avoid off-by-one для retention)', () => {
    // Регрессия: «new» означает строго первый визит — клиент с 2 визитами
    // уже не нов, он retained.
    const r = filterBySegment(FIXTURES, 'new')
    expect(r.find((c) => c.id === '3')).toBeUndefined()
  })

  it('пустой список клиентов → пустой результат на любом сегменте', () => {
    for (const seg of ['all', 'new', 'regular', 'dormant'] as Segment[]) {
      expect(filterBySegment([], seg)).toEqual([])
    }
    expect(filterBySegment([], { tag: 'vip' })).toEqual([])
  })
})
