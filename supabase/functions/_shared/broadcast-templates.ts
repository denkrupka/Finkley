/**
 * Общие шаблоны рассылок (visit_reminder + review_request) — на 3 локалях.
 *
 * Источник истины для:
 *   - send-review-request    (review_request → клиенту после оплаченного визита)
 *   - client-overdue-push    (visit_reminder → клиенту с просроченной регулярностью)
 *   - marketing-test-send    (тестовая отправка owner-у; должен видеть 1-в-1
 *                             то же, что увидит клиент)
 *
 * Marketing-сообщения (массовая рассылка через compose) шаблонов не имеют —
 * текст полностью задаёт владелец. Здесь предоставляется только sample для
 * тест-отправки.
 */

export type Locale = 'ru' | 'pl' | 'en'

export function pickLocale(
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

// =============================================================================
// review_request — после оплаченного визита, просим оставить отзыв
// =============================================================================

const REVIEW = {
  ru: {
    subject: 'Как прошёл ваш визит?',
    sms: 'Спасибо за визит! Оцените нас: {{url}}',
    body_intro: 'Здравствуйте! Спасибо что выбрали',
    body_cta: 'Оцените ваш визит — это займёт 30 секунд:',
    body_button: 'Оставить отзыв',
  },
  pl: {
    subject: 'Jak przebiegła Twoja wizyta?',
    sms: 'Dziękujemy za wizytę! Oceń nas: {{url}}',
    body_intro: 'Dzień dobry! Dziękujemy, że wybrałaś',
    body_cta: 'Oceń wizytę — zajmie 30 sekund:',
    body_button: 'Zostaw opinię',
  },
  en: {
    subject: 'How was your visit?',
    sms: 'Thanks for your visit! Rate us: {{url}}',
    body_intro: 'Hello! Thanks for choosing',
    body_cta: 'Rate your visit — it takes 30 seconds:',
    body_button: 'Leave a review',
  },
} as const

export function buildReviewRequestSms(reviewUrl: string, locale: Locale): string {
  return REVIEW[locale].sms.replace('{{url}}', reviewUrl)
}

export function buildReviewRequestEmail(
  salonName: string,
  reviewUrl: string,
  locale: Locale,
): { subject: string; html: string } {
  const s = REVIEW[locale]
  const subject = `${s.subject} · ${salonName}`
  const html = `<!doctype html>
<html lang="${locale}"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:40px 32px;text-align:center;">
  <h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:800;color:#1A1A2E;">
    ${s.subject}
  </h1>
  <p style="margin:0 0 24px 0;font-size:15px;line-height:22px;color:#334155;">
    ${s.body_intro} <strong>${salonName}</strong>. ${s.body_cta}
  </p>
  <p style="margin:24px 0;">
    <a href="${reviewUrl}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">
      ${s.body_button}
    </a>
  </p>
  <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;">
    Finkley · ${salonName}
  </p>
</td></tr>
</table>
</td></tr></table>
</body></html>`
  return { subject, html }
}

// =============================================================================
// visit_reminder — клиент давно не был, мягко напоминаем
// =============================================================================

const REMIND = {
  ru: {
    subject: 'Соскучились! Пора заглянуть',
    intro: 'Привет, {{name}}!',
    body: 'Давно не виделись — {{days}} дней с прошлого визита ({{category}}). Записаться легко по ссылке ниже:',
    cta: 'Записаться',
    sms: '{{salon}}: давно не виделись! Запишись на {{category}}: {{url}}',
  },
  pl: {
    subject: 'Tęsknimy! Czas wpaść',
    intro: 'Cześć, {{name}}!',
    body: 'Dawno się nie widziałyśmy — {{days}} dni od ostatniej wizyty ({{category}}). Zarezerwuj łatwo poniżej:',
    cta: 'Zarezerwuj',
    sms: '{{salon}}: dawno się nie widziałyśmy! Umów {{category}}: {{url}}',
  },
  en: {
    subject: "We've missed you! Time to drop by",
    intro: 'Hi {{name}}!',
    body: "It's been a while — {{days}} days since your last visit ({{category}}). Book easily below:",
    cta: 'Book',
    sms: '{{salon}}: been a while! Book {{category}}: {{url}}',
  },
} as const

export function buildVisitReminderSms(
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

export function buildVisitReminderEmail(
  salonName: string,
  clientName: string,
  daysSince: number,
  categoryName: string,
  bookUrl: string,
  locale: Locale,
): { subject: string; html: string } {
  const s = REMIND[locale]
  const subject = `${s.subject} — ${salonName}`
  const html = `<!doctype html>
<html lang="${locale}"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:40px 32px;">
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    ${interpolate(s.intro, { name: clientName })}
  </h1>
  <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:#334155;">
    ${interpolate(s.body, { days: daysSince, category: categoryName })}
  </p>
  <p style="margin:24px 0;">
    <a href="${bookUrl}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">
      ${s.cta}
    </a>
  </p>
  <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;">${salonName} · Finkley</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`
  return { subject, html }
}

// =============================================================================
// marketing — массовая рассылка, текст полностью задаёт владелец.
// Здесь только sample для тест-отправки (showcase формата).
// =============================================================================

const MARKETING_SAMPLE = {
  ru: {
    subject: 'Специальное предложение от {{salon}}',
    sms: '{{salon}}: −20% на маникюр в эту субботу! Ответьте «ДА» — забронируем место.',
    body: 'Привет!\n\nВ эту субботу у нас −20% на маникюр в {{salon}}. Свободны окна с 11:00 до 18:00.\n\nОтветьте на это письмо или позвоните — забронируем удобное время.\n\nДо встречи!',
  },
  pl: {
    subject: 'Specjalna oferta od {{salon}}',
    sms: '{{salon}}: −20% na manicure w sobotę! Odpisz „TAK" — zarezerwujemy.',
    body: 'Cześć!\n\nW tę sobotę mamy −20% na manicure w {{salon}}. Wolne okienka od 11:00 do 18:00.\n\nOdpisz na ten email lub zadzwoń — zarezerwujemy dogodny czas.\n\nDo zobaczenia!',
  },
  en: {
    subject: 'Special offer from {{salon}}',
    sms: '{{salon}}: −20% on manicure this Saturday! Reply "YES" to book.',
    body: "Hi!\n\nThis Saturday we have −20% on manicure at {{salon}}. Open slots 11:00 — 18:00.\n\nReply to this email or call — we'll book a time that suits you.\n\nSee you!",
  },
} as const

export function buildMarketingSampleSms(salonName: string, locale: Locale): string {
  return MARKETING_SAMPLE[locale].sms.replaceAll('{{salon}}', salonName)
}

export function buildMarketingSampleEmail(
  salonName: string,
  locale: Locale,
): { subject: string; html: string; text: string } {
  const s = MARKETING_SAMPLE[locale]
  const subject = s.subject.replaceAll('{{salon}}', salonName)
  const text = s.body.replaceAll('{{salon}}', salonName)
  const html = `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\n/g, '<br>')}</p>`
  return { subject, html, text }
}
