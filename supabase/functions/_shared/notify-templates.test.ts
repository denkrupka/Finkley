import { describe, expect, it } from 'vitest'

import {
  normalizeLocale,
  renderEmail,
  renderSms,
  renderTelegram,
  type Locale,
} from './notify-templates.ts'

const ctx = {
  salonName: 'TestSalon',
  logoUrl: null,
  baseUrl: 'https://finkley.app/app',
  salonId: 'salon-uuid',
}

describe('normalizeLocale', () => {
  it('null/undefined → ru', () => {
    expect(normalizeLocale(null)).toBe('ru')
    expect(normalizeLocale(undefined)).toBe('ru')
    expect(normalizeLocale('')).toBe('ru')
  })

  it('BCP-47 префиксы', () => {
    expect(normalizeLocale('pl-PL')).toBe('pl')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('en-GB')).toBe('en')
    expect(normalizeLocale('ru-RU')).toBe('ru')
  })

  it('неизвестный → ru fallback', () => {
    expect(normalizeLocale('uk-UA')).toBe('ru')
    expect(normalizeLocale('xx')).toBe('ru')
  })
})

describe('renderEmail — субджекты и CTA локализованы', () => {
  const locales: Locale[] = ['ru', 'pl', 'en']

  it('ai_insights во всех локалях содержит headline', () => {
    for (const loc of locales) {
      const r = renderEmail(
        'ai_insights',
        { headline: 'Прибыль упала', body: 'на 12%' },
        { ...ctx, locale: loc },
      )
      expect(r.subject).toContain('Прибыль упала')
      expect(r.html).toContain('Прибыль упала')
      expect(r.html).toContain('на 12%')
    }
  })

  it('low_inventory: subject содержит count, html — список', () => {
    const items = [
      { name: 'Krem', current: 0, min: 5 },
      { name: 'Olejek', current: 1, min: 3 },
    ]
    const ru = renderEmail('low_inventory', { items }, { ...ctx, locale: 'ru' })
    expect(ru.subject).toContain('2')
    expect(ru.html).toContain('Krem')
    expect(ru.html).toContain('Olejek')

    const pl = renderEmail('low_inventory', { items }, { ...ctx, locale: 'pl' })
    expect(pl.subject).toContain('Kończą się')

    const en = renderEmail('low_inventory', { items }, { ...ctx, locale: 'en' })
    expect(en.subject).toContain('Running low')
  })

  it('payment_overdue: красный цвет в html, контрагент', () => {
    const r = renderEmail(
      'payment_overdue',
      {
        counterparty: 'Wynajem sp.z.o.o.',
        document_number: 'FV/123',
        amount_formatted: '1 234 zł',
      },
      { ...ctx, locale: 'ru' },
    )
    expect(r.html).toContain('Wynajem sp.z.o.o.')
    expect(r.html).toContain('FV/123')
    expect(r.html).toContain('1 234 zł')
    // Просрочка — красный текст #a32d2d
    expect(r.html).toContain('a32d2d')
  })

  it('payment_due_today vs payment_overdue: разные labels в RU', () => {
    const overdue = renderEmail(
      'payment_overdue',
      { counterparty: '—', amount_formatted: '0' },
      { ...ctx, locale: 'ru' },
    )
    const today = renderEmail(
      'payment_due_today',
      { counterparty: '—', amount_formatted: '0' },
      { ...ctx, locale: 'ru' },
    )
    expect(overdue.subject).not.toBe(today.subject)
    expect(overdue.subject).toContain('просрочен')
    expect(today.subject).toContain('сегодня')
  })

  it('booksy_new_visits: количество в subject + ссылка на /income', () => {
    const r = renderEmail('booksy_new_visits', { count: 7 }, { ...ctx, locale: 'en' })
    expect(r.subject).toContain('7')
    expect(r.html).toContain('/income')
  })

  it('messenger_new_message: sender + preview + channel', () => {
    const r = renderEmail(
      'messenger_new_message',
      { sender: 'Anna', preview: 'Cześć!', channel: 'instagram' },
      { ...ctx, locale: 'pl' },
    )
    expect(r.html).toContain('Anna')
    expect(r.html).toContain('Cześć!')
    expect(r.html).toContain('instagram')
  })

  it('escape: HTML-инъекция в payload не ломает шаблон', () => {
    const r = renderEmail(
      'ai_insights',
      { headline: '<script>alert(1)</script>', body: '"&\'<>' },
      { ...ctx, locale: 'ru' },
    )
    // Содержит экранированную версию, не голый <script>
    expect(r.html).not.toContain('<script>alert(1)</script>')
    expect(r.html).toContain('&lt;script&gt;')
  })

  it('CTA-ссылки строятся с baseUrl + salonId', () => {
    const r = renderEmail('low_inventory', { items: [] }, ctx)
    expect(r.html).toContain('https://finkley.app/app/salon-uuid/inventory')
  })
})

describe('renderTelegram — компактные HTML-сообщения', () => {
  it('ai_insights → <b>headline</b> + body', () => {
    const t = renderTelegram('ai_insights', { headline: 'Foo', body: 'Bar' }, 'ru')
    expect(t).toContain('<b>Foo</b>')
    expect(t).toContain('Bar')
  })

  it('low_inventory ≤10 items: показывает все', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      name: `Item${i}`,
      current: 0,
      min: 3,
    }))
    const t = renderTelegram('low_inventory', { items }, 'ru')
    expect(t).toContain('Item0')
    expect(t).toContain('Item4')
    expect(t).not.toContain('…ещё')
  })

  it('low_inventory >10 items: показывает 10 + "ещё N"', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      name: `Item${i}`,
      current: 0,
      min: 3,
    }))
    const ru = renderTelegram('low_inventory', { items }, 'ru')
    expect(ru).toContain('Item0')
    expect(ru).toContain('Item9')
    expect(ru).not.toContain('Item10')
    expect(ru).toContain('…ещё 5')

    const en = renderTelegram('low_inventory', { items }, 'en')
    expect(en).toContain('…and 5 more')

    const pl = renderTelegram('low_inventory', { items }, 'pl')
    expect(pl).toContain('…jeszcze 5')
  })

  it('payment_overdue: 🔴 emoji + bold counterparty', () => {
    const t = renderTelegram(
      'payment_overdue',
      { counterparty: 'Vendor', amount_formatted: '500' },
      'ru',
    )
    expect(t).toContain('🔴')
    expect(t).toContain('<b>Vendor</b>')
    expect(t).toContain('500')
  })

  it('messenger_new_message: дефолт ru если locale не задан', () => {
    const t = renderTelegram('messenger_new_message', {
      sender: 'Bob',
      preview: 'Hi',
      channel: 'whatsapp',
    })
    expect(t).toContain('Bob')
    expect(t).toContain('Hi')
  })
})

describe('renderSms — ≤160 символов', () => {
  it('low_inventory локализован', () => {
    expect(renderSms('low_inventory', { items: [{}, {}, {}] }, 'ru')).toContain('3')
    expect(renderSms('low_inventory', { items: [{}, {}, {}] }, 'pl')).toContain('3')
    expect(renderSms('low_inventory', { items: [{}, {}, {}] }, 'en')).toContain('3')
  })

  it('обрезает длинные ai_insights до 160', () => {
    const longBody = 'X'.repeat(300)
    const sms = renderSms('ai_insights', { headline: 'H', body: longBody }, 'ru')
    expect(sms.length).toBeLessThanOrEqual(160)
    expect(sms).toMatch(/…$/)
  })

  it('payment_overdue vs payment_due_today разные тексты в RU', () => {
    const overdue = renderSms(
      'payment_overdue',
      { counterparty: 'X', amount_formatted: '100' },
      'ru',
    )
    const today = renderSms(
      'payment_due_today',
      { counterparty: 'X', amount_formatted: '100' },
      'ru',
    )
    expect(overdue).toContain('просрочен')
    expect(today).toContain('сегодня')
  })

  it('default локаль — ru', () => {
    const sms = renderSms('weekly_digest', {})
    expect(sms).toContain('дайджест')
  })
})
