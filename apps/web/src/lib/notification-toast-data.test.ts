import { describe, expect, it } from 'vitest'

import { buildToastData, type InAppNotification } from './notification-toast-data'

const t = (k: string, opts?: Record<string, unknown>) =>
  String(opts?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_, key) => String(opts?.[key] ?? ''))

function notif(type: string, payload: Record<string, unknown> = {}): InAppNotification {
  return {
    id: 'n1',
    user_id: 'u1',
    salon_id: 's1',
    type,
    payload,
    read_at: null,
    created_at: '2026-05-29T10:00:00Z',
  }
}

describe('buildToastData', () => {
  it('ai_insights — headline + body, link на dashboard', () => {
    const r = buildToastData(
      notif('ai_insights', { headline: 'Visit drops', body: 'Last week -15%' }),
      { t, salonId: 's1' },
    )
    expect(r.title).toContain('Visit drops')
    expect(r.description).toBe('Last week -15%')
    expect(r.url).toBe('/s1/dashboard')
  })

  it('low_inventory — кол-во items в description', () => {
    const r = buildToastData(notif('low_inventory', { items: [{ name: 'a' }, { name: 'b' }] }), {
      t,
      salonId: 's1',
    })
    expect(r.description).toContain('2 позиций')
    expect(r.url).toBe('/s1/inventory')
  })

  it('payment_overdue — title красный, link на expenses pending', () => {
    const r = buildToastData(
      notif('payment_overdue', { counterparty: 'X', amount_formatted: '500 zł' }),
      { t, salonId: 's1' },
    )
    expect(r.title).toContain('просрочен')
    expect(r.description).toBe('X · 500 zł')
    expect(r.url).toBe('/s1/expenses?tab=pending')
  })

  it('payment_due_today — title с часами', () => {
    expect(buildToastData(notif('payment_due_today'), { t, salonId: 's1' }).title).toContain(
      'сегодня',
    )
    expect(buildToastData(notif('payment_due_1d'), { t, salonId: 's1' }).title).toContain('завтра')
    expect(buildToastData(notif('payment_due_2d'), { t, salonId: 's1' }).title).toContain('2 дня')
  })

  it('booksy_new_visits — кол-во в title, link на visits', () => {
    const r = buildToastData(notif('booksy_new_visits', { count: 7 }), { t, salonId: 's1' })
    expect(r.title).toContain('7')
    expect(r.url).toBe('/s1/income?tab=visits')
  })

  it('messenger_new_message — sender в title, preview в description', () => {
    const r = buildToastData(
      notif('messenger_new_message', { sender: 'Анна', preview: 'Привет, можно записаться?' }),
      { t, salonId: 's1' },
    )
    expect(r.title).toContain('Анна')
    expect(r.description).toBe('Привет, можно записаться?')
    expect(r.url).toBe('/s1/messenger')
  })

  it('weekly_digest и daily_digest — link на reports', () => {
    expect(buildToastData(notif('weekly_digest'), { t, salonId: 's1' }).url).toBe('/s1/reports')
    expect(buildToastData(notif('daily_digest'), { t, salonId: 's1' }).url).toBe('/s1/reports')
  })

  it('unknown type — fallback на generic, без url', () => {
    const r = buildToastData(notif('unknown_xyz'), { t, salonId: 's1' })
    expect(r.title).toContain('Уведомление')
    expect(r.url).toBeUndefined()
  })

  it('salon_id из row перебивает ctx.salonId', () => {
    const r = buildToastData(
      { ...notif('booksy_new_visits', { count: 3 }), salon_id: 'other-salon' },
      { t, salonId: 's1' },
    )
    expect(r.url).toBe('/other-salon/income?tab=visits')
  })

  it('row.salon_id=null → fallback на ctx.salonId', () => {
    const r = buildToastData(
      { ...notif('booksy_new_visits', { count: 1 }), salon_id: null },
      { t, salonId: 'fallback-salon' },
    )
    expect(r.url).toBe('/fallback-salon/income?tab=visits')
  })

  it('нет salonId вообще → url undefined', () => {
    const r = buildToastData(
      { ...notif('booksy_new_visits', { count: 1 }), salon_id: null },
      { t, salonId: undefined },
    )
    expect(r.url).toBeUndefined()
  })
})
