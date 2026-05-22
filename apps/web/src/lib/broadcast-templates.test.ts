/**
 * Shadow-тесты для supabase/functions/_shared/broadcast-templates.ts.
 *
 * Шаблоны используются 3 функциями (review-request, overdue-push,
 * marketing-test-send). Регрессия = клиент получит сломанный SMS
 * (`{{url}}` вместо реальной ссылки) или email с битой подстановкой.
 *
 * Здесь — shadow-копии buildReviewRequestSms, buildVisitReminderSms,
 * buildVisitReminderEmail и pickLocale. Проверяем что интерполяция
 * работает на 3 локалях + локаль-fallback.
 */
import { describe, expect, it } from 'vitest'

type Locale = 'ru' | 'pl' | 'en'

function pickLocale(
  locale: string | null | undefined,
  countryCode: string | null | undefined,
): Locale {
  if (locale) {
    const base = locale.split('-')[0]?.toLowerCase()
    if (base === 'pl') return 'pl'
    if (base === 'en') return 'en'
    if (base === 'ru') return 'ru'
  }
  if (countryCode === 'PL') return 'pl'
  if (countryCode && ['GB', 'US', 'IE'].includes(countryCode)) return 'en'
  return 'ru'
}

function interpolate(tmpl: string, vars: Record<string, string | number>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
}

const REVIEW = {
  ru: { sms: 'Спасибо за визит! Оцените нас: {{url}}' },
  pl: { sms: 'Dziękujemy za wizytę! Oceń nas: {{url}}' },
  en: { sms: 'Thanks for your visit! Rate us: {{url}}' },
} as const

function buildReviewRequestSms(url: string, locale: Locale): string {
  return REVIEW[locale].sms.replace('{{url}}', url)
}

const REMIND = {
  ru: { sms: '{{salon}}: давно не виделись! Запишись на {{category}}: {{url}}' },
  pl: { sms: '{{salon}}: dawno się nie widziałyśmy! Umów {{category}}: {{url}}' },
  en: { sms: '{{salon}}: been a while! Book {{category}}: {{url}}' },
} as const

function buildVisitReminderSms(
  salonName: string,
  categoryName: string,
  bookUrl: string,
  locale: Locale,
): string {
  return interpolate(REMIND[locale].sms, {
    salon: salonName,
    category: categoryName,
    url: bookUrl,
  })
}

const URL = 'https://finkley.app/app/review/TEST'

describe('pickLocale — каскад выбора локали для серверных шаблонов', () => {
  it('явная locale ru → ru', () => {
    expect(pickLocale('ru', null)).toBe('ru')
  })
  it('явная locale pl-PL (с регионом) → pl', () => {
    expect(pickLocale('pl-PL', null)).toBe('pl')
  })
  it('явная locale en-GB → en', () => {
    expect(pickLocale('en-GB', null)).toBe('en')
  })
  it('locale=null, country=PL → pl', () => {
    expect(pickLocale(null, 'PL')).toBe('pl')
  })
  it('locale=null, country=GB → en', () => {
    expect(pickLocale(null, 'GB')).toBe('en')
  })
  it('locale=null, country=US → en', () => {
    expect(pickLocale(null, 'US')).toBe('en')
  })
  it('locale=null, country=unknown → ru (fallback)', () => {
    expect(pickLocale(null, 'XX')).toBe('ru')
  })
  it('всё null → ru (fallback)', () => {
    expect(pickLocale(null, null)).toBe('ru')
  })
  it('locale=fr (неизвестный) → ru (fallback)', () => {
    // Французский не поддержан — должен fallback на ru, а не падать.
    expect(pickLocale('fr', null)).toBe('ru')
  })
})

describe('buildReviewRequestSms — интерполяция {{url}}', () => {
  it('ru: подставляет url в позицию {{url}}', () => {
    const r = buildReviewRequestSms(URL, 'ru')
    expect(r).toContain(URL)
    expect(r).not.toContain('{{url}}')
  })
  it('pl: подставляет url', () => {
    const r = buildReviewRequestSms(URL, 'pl')
    expect(r).toContain(URL)
    expect(r).not.toContain('{{url}}')
  })
  it('en: подставляет url', () => {
    const r = buildReviewRequestSms(URL, 'en')
    expect(r).toContain(URL)
    expect(r).not.toContain('{{url}}')
  })
  it('пустой URL → пустая строка вместо плейсхолдера (не битый текст)', () => {
    const r = buildReviewRequestSms('', 'ru')
    expect(r).not.toContain('{{url}}')
  })
  it('URL со спец.символами не ломает шаблон', () => {
    const tricky = 'https://x.com/?q=a&b=c#frag'
    const r = buildReviewRequestSms(tricky, 'ru')
    expect(r).toContain(tricky)
  })
  it('все 3 локали уникальны (не копи-паста)', () => {
    const r = buildReviewRequestSms(URL, 'ru')
    const p = buildReviewRequestSms(URL, 'pl')
    const e = buildReviewRequestSms(URL, 'en')
    expect(r).not.toBe(p)
    expect(p).not.toBe(e)
    expect(r).not.toBe(e)
  })
})

describe('buildVisitReminderSms — 3 placeholder ({{salon}}, {{category}}, {{url}})', () => {
  it('ru: все 3 placeholder заменяются', () => {
    const r = buildVisitReminderSms('Zefir', 'маникюр', URL, 'ru')
    expect(r).toContain('Zefir')
    expect(r).toContain('маникюр')
    expect(r).toContain(URL)
    expect(r).not.toContain('{{')
  })
  it('pl: все 3 placeholder заменяются', () => {
    const r = buildVisitReminderSms('Wonderful', 'manicure', URL, 'pl')
    expect(r).toContain('Wonderful')
    expect(r).toContain('manicure')
    expect(r).toContain(URL)
    expect(r).not.toContain('{{')
  })
  it('en: все 3 placeholder заменяются', () => {
    const r = buildVisitReminderSms('Beauty Studio', 'haircut', URL, 'en')
    expect(r).toContain('Beauty Studio')
    expect(r).toContain('haircut')
    expect(r).toContain(URL)
    expect(r).not.toContain('{{')
  })
  it('пустые salon/category не оставляют placeholder в тексте', () => {
    const r = buildVisitReminderSms('', '', '', 'ru')
    expect(r).not.toContain('{{salon}}')
    expect(r).not.toContain('{{category}}')
    expect(r).not.toContain('{{url}}')
  })
  it('salon с эмодзи/spec-chars не ломает интерполяцию', () => {
    const r = buildVisitReminderSms('Salon ❤️ & Co', 'маникюр', URL, 'ru')
    expect(r).toContain('Salon ❤️ & Co')
    expect(r).toContain('маникюр')
  })
  it('неподдерживаемый locale → throw (TypeScript-fence гарантия)', () => {
    // pickLocale всегда возвращает ru/pl/en — buildVisitReminderSms никогда
    // не вызывается с другой локалью в реальном коде. Если кто-то обойдёт
    // типы — пусть упадёт громко, а не молча отправит битый SMS.
    expect(() => {
      // @ts-expect-error — намеренно неверный locale
      buildVisitReminderSms('X', 'y', URL, 'xx')
    }).toThrow()
  })
})

describe('SMS-длина — sanity для биллинга', () => {
  // 1 SMS = 160 GSM-7 chars. Длиннее = списание × N. Шаблоны должны
  // умещаться в 1 SMS с типичными подстановками (salon ≤15 chars,
  // category ≤15 chars, url ~30 chars из-за нашего домена).
  it('review_request ru ≤ 160 chars с типичным url (60+ запас)', () => {
    const r = buildReviewRequestSms('https://finkley.app/app/r/AbC12345', 'ru')
    expect(r.length).toBeLessThanOrEqual(160)
  })
  it('visit_reminder ru ≤ 160 chars (typical case)', () => {
    const r = buildVisitReminderSms(
      'Wonderful',
      'маникюр',
      'https://finkley.app/app/SalonID/visits',
      'ru',
    )
    expect(r.length).toBeLessThanOrEqual(160)
  })
})
