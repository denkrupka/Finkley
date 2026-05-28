/**
 * T37/T41 — шаблоны уведомлений для send-notification.
 *
 * Для каждого type из NotificationTypeKey есть три рендера:
 *   - email:  { subject, html } — HTML-письмо с inline-стилями
 *   - telegram: text (HTML markup поддерживается)
 *   - sms: text (≤160 символов рекомендовано)
 *
 * Шаблоны принимают строго типизированный payload и возвращают готовый
 * текст на выбранном языке (ru/pl/en) — задаётся через ctx.locale или
 * параметр locale в render* функциях. По умолчанию ru.
 */

export type Locale = 'ru' | 'pl' | 'en'

export function normalizeLocale(raw: string | null | undefined): Locale {
  if (!raw) return 'ru'
  const low = raw.toLowerCase()
  if (low.startsWith('pl')) return 'pl'
  if (low.startsWith('en')) return 'en'
  return 'ru'
}

export type NotificationType =
  | 'weekly_digest'
  | 'daily_digest'
  | 'ai_insights'
  | 'payment_due_2d'
  | 'payment_due_1d'
  | 'payment_due_today'
  | 'payment_overdue'
  | 'low_inventory'
  | 'booksy_new_visits'
  | 'calendar_conflicts'
  | 'messenger_new_message'

export type NotificationPayload = Record<string, unknown>

// ─── Перевод строк ─────────────────────────────────────────────────────────

type Strings = {
  ai_insights_title: string
  low_inv_subject: (n: number) => string
  low_inv_title: string
  low_inv_pre: (n: number) => string
  low_inv_body: string
  low_inv_cta: string
  payment_due_today: string
  payment_due_1d: string
  payment_due_2d: string
  payment_overdue: string
  payment_counterparty: string
  payment_document: string
  payment_amount: string
  payment_cta: string
  booksy_subject: (n: number) => string
  booksy_title: (n: number) => string
  booksy_with_sum: (sum: string) => string
  booksy_no_sum: string
  booksy_cta: string
  conflict_subject: (n: number) => string
  conflict_title: string
  conflict_pre: (n: number) => string
  conflict_body: string
  conflict_cta: string
  messenger_subject: (sender: string, channel: string) => string
  messenger_title: (sender: string) => string
  messenger_cta: string
  weekly_digest_title: string
  daily_digest_title: string
  digest_subject_prefix: string
  digest_cta: string
  open_in_portal: string
  footer: string
  // SMS prefix:
  sms_brand: string
  sms_low_inv: (n: number) => string
  sms_overdue: string
  sms_due_today: string
  sms_due_1d: string
  sms_due_2d: string
  sms_booksy: (n: number) => string
  sms_conflict: (n: number) => string
  sms_new_msg: (sender: string) => string
  sms_weekly: string
  sms_daily: string
  sms_ai: (h: string, b: string) => string
  sms_default: string
}

const STRINGS: Record<Locale, Strings> = {
  ru: {
    ai_insights_title: 'AI заметил важное',
    low_inv_subject: (n) => `⚠️ Заканчиваются материалы: ${n}`,
    low_inv_title: 'Пора закупиться',
    low_inv_pre: (n) => `${n} позиций ниже минимума`,
    low_inv_body: 'Эти материалы упали ниже минимального остатка:',
    low_inv_cta: 'Открыть склад',
    payment_due_today: 'Платёж сегодня',
    payment_due_1d: 'Платёж завтра',
    payment_due_2d: 'Платёж через 2 дня',
    payment_overdue: 'Платёж просрочен',
    payment_counterparty: 'Контрагент:',
    payment_document: 'Документ:',
    payment_amount: 'Сумма:',
    payment_cta: 'Открыть платёж',
    booksy_subject: (n) => `📅 Импортировано из Booksy: ${n} визитов`,
    booksy_title: (n) => `Booksy → +${n} визитов`,
    booksy_with_sum: (sum) => `Загружено новых визитов на сумму ${sum}.`,
    booksy_no_sum: 'Загружены новые визиты.',
    booksy_cta: 'Открыть визиты',
    conflict_subject: (n) => `⚠️ Конфликт в календаре: ${n}`,
    conflict_title: 'Двойные записи в календаре',
    conflict_pre: (n) => `${n} конфликтов требуют разрешения`,
    conflict_body: 'Несколько клиентов записаны на одно время:',
    conflict_cta: 'Открыть календарь',
    messenger_subject: (s, ch) => `💬 Новое сообщение от ${s} (${ch})`,
    messenger_title: (s) => `Сообщение от ${s}`,
    messenger_cta: 'Открыть мессенджер',
    weekly_digest_title: 'Дайджест за неделю',
    daily_digest_title: 'Сводка за день',
    digest_subject_prefix: '📊',
    digest_cta: 'Открыть отчёты',
    open_in_portal: 'Посмотреть в портале',
    footer: 'Finkley · уведомление о событии в твоём салоне',
    sms_brand: 'Finkley',
    sms_low_inv: (n) => `Finkley: заканчиваются материалы (${n}). Проверь склад в портале.`,
    sms_overdue: 'просрочен',
    sms_due_today: 'сегодня',
    sms_due_1d: 'завтра',
    sms_due_2d: 'через 2 дня',
    sms_booksy: (n) => `Finkley: импорт Booksy завершён, +${n} визитов.`,
    sms_conflict: (n) => `Finkley: конфликт в календаре — ${n} двойных записей.`,
    sms_new_msg: (s) => `Finkley: новое сообщение от ${s}.`,
    sms_weekly: 'Finkley: дайджест за неделю готов в портале.',
    sms_daily: 'Finkley: сводка за день готова в портале.',
    sms_ai: (h, b) => `Finkley AI: ${h}. ${b}`,
    sms_default: 'Finkley: уведомление в портале.',
  },
  pl: {
    ai_insights_title: 'AI zauważył coś ważnego',
    low_inv_subject: (n) => `⚠️ Kończą się materiały: ${n}`,
    low_inv_title: 'Czas uzupełnić zapasy',
    low_inv_pre: (n) => `${n} pozycji poniżej minimum`,
    low_inv_body: 'Te materiały spadły poniżej minimalnego stanu:',
    low_inv_cta: 'Otwórz magazyn',
    payment_due_today: 'Płatność dziś',
    payment_due_1d: 'Płatność jutro',
    payment_due_2d: 'Płatność za 2 dni',
    payment_overdue: 'Płatność po terminie',
    payment_counterparty: 'Kontrahent:',
    payment_document: 'Dokument:',
    payment_amount: 'Kwota:',
    payment_cta: 'Otwórz płatność',
    booksy_subject: (n) => `📅 Zaimportowano z Booksy: ${n} wizyt`,
    booksy_title: (n) => `Booksy → +${n} wizyt`,
    booksy_with_sum: (sum) => `Zaimportowano nowe wizyty na kwotę ${sum}.`,
    booksy_no_sum: 'Zaimportowano nowe wizyty.',
    booksy_cta: 'Otwórz wizyty',
    conflict_subject: (n) => `⚠️ Konflikt w kalendarzu: ${n}`,
    conflict_title: 'Podwójne rezerwacje w kalendarzu',
    conflict_pre: (n) => `${n} konfliktów wymaga rozwiązania`,
    conflict_body: 'Kilku klientów zapisanych na ten sam czas:',
    conflict_cta: 'Otwórz kalendarz',
    messenger_subject: (s, ch) => `💬 Nowa wiadomość od ${s} (${ch})`,
    messenger_title: (s) => `Wiadomość od ${s}`,
    messenger_cta: 'Otwórz komunikator',
    weekly_digest_title: 'Tygodniowe podsumowanie',
    daily_digest_title: 'Codzienne podsumowanie',
    digest_subject_prefix: '📊',
    digest_cta: 'Otwórz raporty',
    open_in_portal: 'Otwórz w portalu',
    footer: 'Finkley · powiadomienie o zdarzeniu w Twoim salonie',
    sms_brand: 'Finkley',
    sms_low_inv: (n) => `Finkley: kończą się materiały (${n}). Sprawdź magazyn w portalu.`,
    sms_overdue: 'po terminie',
    sms_due_today: 'dziś',
    sms_due_1d: 'jutro',
    sms_due_2d: 'za 2 dni',
    sms_booksy: (n) => `Finkley: import Booksy zakończony, +${n} wizyt.`,
    sms_conflict: (n) => `Finkley: konflikt w kalendarzu — ${n} podwójnych rezerwacji.`,
    sms_new_msg: (s) => `Finkley: nowa wiadomość od ${s}.`,
    sms_weekly: 'Finkley: tygodniowe podsumowanie gotowe w portalu.',
    sms_daily: 'Finkley: codzienne podsumowanie gotowe w portalu.',
    sms_ai: (h, b) => `Finkley AI: ${h}. ${b}`,
    sms_default: 'Finkley: powiadomienie w portalu.',
  },
  en: {
    ai_insights_title: 'AI spotted something important',
    low_inv_subject: (n) => `⚠️ Running low on supplies: ${n}`,
    low_inv_title: 'Time to restock',
    low_inv_pre: (n) => `${n} items below minimum`,
    low_inv_body: 'These items have dropped below the minimum stock:',
    low_inv_cta: 'Open inventory',
    payment_due_today: 'Payment due today',
    payment_due_1d: 'Payment due tomorrow',
    payment_due_2d: 'Payment in 2 days',
    payment_overdue: 'Payment overdue',
    payment_counterparty: 'Counterparty:',
    payment_document: 'Document:',
    payment_amount: 'Amount:',
    payment_cta: 'Open payment',
    booksy_subject: (n) => `📅 Imported from Booksy: ${n} visits`,
    booksy_title: (n) => `Booksy → +${n} visits`,
    booksy_with_sum: (sum) => `New visits imported totalling ${sum}.`,
    booksy_no_sum: 'New visits imported.',
    booksy_cta: 'Open visits',
    conflict_subject: (n) => `⚠️ Calendar conflict: ${n}`,
    conflict_title: 'Double bookings in calendar',
    conflict_pre: (n) => `${n} conflicts need resolving`,
    conflict_body: 'Multiple clients are booked at the same time:',
    conflict_cta: 'Open calendar',
    messenger_subject: (s, ch) => `💬 New message from ${s} (${ch})`,
    messenger_title: (s) => `Message from ${s}`,
    messenger_cta: 'Open messenger',
    weekly_digest_title: 'Weekly digest',
    daily_digest_title: 'Daily summary',
    digest_subject_prefix: '📊',
    digest_cta: 'Open reports',
    open_in_portal: 'Open in portal',
    footer: 'Finkley · notification about an event in your salon',
    sms_brand: 'Finkley',
    sms_low_inv: (n) => `Finkley: ${n} items low. Check inventory.`,
    sms_overdue: 'overdue',
    sms_due_today: 'today',
    sms_due_1d: 'tomorrow',
    sms_due_2d: 'in 2 days',
    sms_booksy: (n) => `Finkley: Booksy import done, +${n} visits.`,
    sms_conflict: (n) => `Finkley: calendar conflict — ${n} double bookings.`,
    sms_new_msg: (s) => `Finkley: new message from ${s}.`,
    sms_weekly: 'Finkley: weekly digest ready in portal.',
    sms_daily: 'Finkley: daily summary ready in portal.',
    sms_ai: (h, b) => `Finkley AI: ${h}. ${b}`,
    sms_default: 'Finkley: notification in portal.',
  },
}

function S(locale: Locale): Strings {
  return STRINGS[locale]
}

export type RenderedEmail = { subject: string; html: string }

// ─── Base wrappers ─────────────────────────────────────────────────────────

function emailShell(opts: {
  salonName?: string
  logoUrl?: string | null
  title: string
  preheader?: string
  body: string
  ctaUrl?: string
  ctaLabel?: string
  footer?: string
}): string {
  const logo = opts.logoUrl
    ? `<img src="${escape(opts.logoUrl)}" alt="" style="display:block;max-width:120px;max-height:48px;margin:0 0 16px 0;border-radius:6px;" />`
    : ''
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;color:transparent">${escape(opts.preheader)}</div>`
    : ''
  const cta = opts.ctaUrl
    ? `<div style="margin-top:24px"><a href="${escape(opts.ctaUrl)}" style="display:inline-block;background:#1c1e4f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${escape(
        opts.ctaLabel ?? 'Открыть',
      )}</a></div>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f4f0;color:#1a1a18;line-height:1.5">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
<tr><td>
${logo}
<h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#1c1e4f">${escape(opts.title)}</h1>
${opts.salonName ? `<p style="margin:0 0 16px 0;color:#6b6a65;font-size:13px">${escape(opts.salonName)}</p>` : ''}
${opts.body}
${cta}
<hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:24px 0 12px 0" />
<p style="margin:0;color:#a0a09a;font-size:11px">${escape(opts.footer ?? 'Finkley · уведомление о событии в твоём салоне')}</p>
</td></tr></table></body></html>`
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Templates ─────────────────────────────────────────────────────────────

type Ctx = {
  salonName?: string
  logoUrl?: string | null
  baseUrl?: string // https://finkley.app
  salonId?: string
  locale?: Locale
}

export function renderEmail(
  type: NotificationType,
  payload: NotificationPayload,
  ctx: Ctx,
): RenderedEmail {
  const loc = ctx.locale ?? 'ru'
  const s = S(loc)
  const baseHref = `${ctx.baseUrl ?? ''}/${ctx.salonId ?? ''}`
  switch (type) {
    case 'ai_insights': {
      const headline = String(payload.headline ?? s.ai_insights_title)
      const body = String(payload.body ?? '')
      return {
        subject: `🔮 ${headline}`,
        html: emailShell({
          ...ctx,
          title: headline,
          preheader: body.slice(0, 80),
          body: `<p style="margin:0;color:#1a1a18;font-size:15px">${escape(body)}</p>`,
          ctaUrl: `${baseHref}/dashboard`,
          ctaLabel: s.open_in_portal,
          footer: s.footer,
        }),
      }
    }
    case 'low_inventory': {
      const items = (payload.items as Array<{ name: string; current: number; min: number }>) ?? []
      const list = items
        .map(
          (it) =>
            `<tr><td style="padding:8px 0;border-top:1px solid rgba(0,0,0,0.08)"><strong>${escape(it.name)}</strong></td><td style="padding:8px 0;border-top:1px solid rgba(0,0,0,0.08);text-align:right;color:#a32d2d;font-weight:600">${it.current} / ${it.min}</td></tr>`,
        )
        .join('')
      return {
        subject: s.low_inv_subject(items.length),
        html: emailShell({
          ...ctx,
          title: s.low_inv_title,
          preheader: s.low_inv_pre(items.length),
          body: `<p style="margin:0 0 12px 0;color:#1a1a18;font-size:14px">${escape(s.low_inv_body)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${list}</table>`,
          ctaUrl: `${baseHref}/inventory`,
          ctaLabel: s.low_inv_cta,
          footer: s.footer,
        }),
      }
    }
    case 'payment_due_2d':
    case 'payment_due_1d':
    case 'payment_due_today':
    case 'payment_overdue': {
      const docNum = String(payload.document_number ?? '')
      const counterparty = String(payload.counterparty ?? '—')
      const amount = String(payload.amount_formatted ?? '')
      const dueLabel =
        type === 'payment_overdue'
          ? s.payment_overdue
          : type === 'payment_due_today'
            ? s.payment_due_today
            : type === 'payment_due_1d'
              ? s.payment_due_1d
              : s.payment_due_2d
      return {
        subject: `💸 ${dueLabel}: ${counterparty} ${amount}`,
        html: emailShell({
          ...ctx,
          title: dueLabel,
          preheader: `${counterparty} · ${amount}`,
          body: `<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr><td style="padding:6px 0;color:#6b6a65">${escape(s.payment_counterparty)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escape(counterparty)}</td></tr>
<tr><td style="padding:6px 0;color:#6b6a65">${escape(s.payment_document)}</td><td style="padding:6px 0;text-align:right">${escape(docNum)}</td></tr>
<tr><td style="padding:6px 0;color:#6b6a65">${escape(s.payment_amount)}</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:18px;color:${type === 'payment_overdue' ? '#a32d2d' : '#1c1e4f'}">${escape(amount)}</td></tr>
</table>`,
          ctaUrl: `${baseHref}/expenses?tab=pending`,
          ctaLabel: s.payment_cta,
          footer: s.footer,
        }),
      }
    }
    case 'booksy_new_visits': {
      const count = Number(payload.count ?? 0)
      const sum = String(payload.sum_formatted ?? '')
      return {
        subject: s.booksy_subject(count),
        html: emailShell({
          ...ctx,
          title: s.booksy_title(count),
          preheader: sum ? `${sum}` : undefined,
          body: `<p style="margin:0;color:#1a1a18;font-size:14px">${
            sum ? escape(s.booksy_with_sum(sum)) : escape(s.booksy_no_sum)
          }</p>`,
          ctaUrl: `${baseHref}/income?tab=visits`,
          ctaLabel: s.booksy_cta,
          footer: s.footer,
        }),
      }
    }
    case 'calendar_conflicts': {
      const conflicts =
        (payload.conflicts as Array<{ staff: string; time: string; clients: string }>) ?? []
      const list = conflicts
        .map(
          (c) =>
            `<li style="margin:6px 0"><strong>${escape(c.staff)}</strong> · ${escape(c.time)} · ${escape(c.clients)}</li>`,
        )
        .join('')
      return {
        subject: s.conflict_subject(conflicts.length),
        html: emailShell({
          ...ctx,
          title: s.conflict_title,
          preheader: s.conflict_pre(conflicts.length),
          body: `<p style="margin:0 0 8px 0;color:#1a1a18;font-size:14px">${escape(s.conflict_body)}</p>
<ul style="margin:0;padding-left:18px;color:#1a1a18;font-size:13px">${list}</ul>`,
          ctaUrl: `${baseHref}/income?tab=visits&view=calendar`,
          ctaLabel: s.conflict_cta,
          footer: s.footer,
        }),
      }
    }
    case 'messenger_new_message': {
      const sender = String(payload.sender ?? '—')
      const preview = String(payload.preview ?? '')
      const channel = String(payload.channel ?? '')
      return {
        subject: s.messenger_subject(sender, channel),
        html: emailShell({
          ...ctx,
          title: s.messenger_title(sender),
          preheader: preview.slice(0, 80),
          body: `<p style="margin:0;color:#6b6a65;font-size:13px">${escape(channel)}</p>
<blockquote style="margin:12px 0;padding:12px 16px;background:#f1efe8;border-radius:8px;color:#1a1a18;font-size:14px">«${escape(preview)}»</blockquote>`,
          ctaUrl: `${baseHref}/messenger`,
          ctaLabel: s.messenger_cta,
          footer: s.footer,
        }),
      }
    }
    case 'weekly_digest':
    case 'daily_digest': {
      const summary = String(payload.summary ?? '')
      const title = type === 'weekly_digest' ? s.weekly_digest_title : s.daily_digest_title
      return {
        subject: `${s.digest_subject_prefix} ${title}`,
        html: emailShell({
          ...ctx,
          title,
          body: `<p style="margin:0;color:#1a1a18;font-size:14px">${escape(summary)}</p>`,
          ctaUrl: `${baseHref}/reports`,
          ctaLabel: s.digest_cta,
          footer: s.footer,
        }),
      }
    }
    default: {
      return {
        subject: 'Finkley',
        html: emailShell({
          ...ctx,
          title: 'Finkley',
          body: `<p style="margin:0;color:#1a1a18;font-size:14px">${escape(JSON.stringify(payload))}</p>`,
          footer: s.footer,
        }),
      }
    }
  }
}

export function renderTelegram(
  type: NotificationType,
  payload: NotificationPayload,
  locale: Locale = 'ru',
): string {
  const s = S(locale)
  const more = (n: number) =>
    locale === 'pl' ? `\n…jeszcze ${n}` : locale === 'en' ? `\n…and ${n} more` : `\n…ещё ${n}`
  switch (type) {
    case 'ai_insights':
      return `🔮 <b>${escape(String(payload.headline ?? s.ai_insights_title))}</b>\n\n${escape(String(payload.body ?? ''))}`
    case 'low_inventory': {
      const items = (payload.items as Array<{ name: string; current: number; min: number }>) ?? []
      const list = items
        .slice(0, 10)
        .map((it) => `• <b>${escape(it.name)}</b> — ${it.current}/${it.min}`)
        .join('\n')
      const tail = items.length > 10 ? more(items.length - 10) : ''
      return `⚠️ <b>${escape(s.low_inv_title)}:</b> ${items.length}\n\n${list}${tail}`
    }
    case 'payment_due_2d':
    case 'payment_due_1d':
    case 'payment_due_today':
    case 'payment_overdue': {
      const dueLabel =
        type === 'payment_overdue'
          ? `🔴 <b>${escape(s.payment_overdue)}</b>`
          : type === 'payment_due_today'
            ? `⏰ <b>${escape(s.payment_due_today)}</b>`
            : type === 'payment_due_1d'
              ? `⏰ <b>${escape(s.payment_due_1d)}</b>`
              : `🗓 <b>${escape(s.payment_due_2d)}</b>`
      return `${dueLabel}\n\n<b>${escape(String(payload.counterparty ?? ''))}</b>\n${escape(String(payload.document_number ?? ''))}\n${escape(s.payment_amount)} <b>${escape(String(payload.amount_formatted ?? ''))}</b>`
    }
    case 'booksy_new_visits':
      return `📅 <b>${escape(s.booksy_title(Number(payload.count ?? 0)))}</b>${payload.sum_formatted ? ` — ${escape(String(payload.sum_formatted))}` : ''}`
    case 'calendar_conflicts': {
      const conflicts =
        (payload.conflicts as Array<{ staff: string; time: string; clients: string }>) ?? []
      const list = conflicts
        .slice(0, 5)
        .map((c) => `• <b>${escape(c.staff)}</b> · ${escape(c.time)} · ${escape(c.clients)}`)
        .join('\n')
      const tail = conflicts.length > 5 ? more(conflicts.length - 5) : ''
      return `⚠️ <b>${escape(s.conflict_title)}:</b> ${conflicts.length}\n\n${list}${tail}`
    }
    case 'messenger_new_message':
      return `💬 <b>${escape(s.messenger_title(String(payload.sender ?? '')))}</b>\n<i>${escape(String(payload.channel ?? ''))}</i>\n\n«${escape(String(payload.preview ?? ''))}»`
    case 'weekly_digest':
    case 'daily_digest':
      return `📊 <b>${escape(type === 'weekly_digest' ? s.weekly_digest_title : s.daily_digest_title)}</b>\n\n${escape(String(payload.summary ?? ''))}`
    default:
      return `🔔 ${escape(JSON.stringify(payload).slice(0, 200))}`
  }
}

export function renderSms(
  type: NotificationType,
  payload: NotificationPayload,
  locale: Locale = 'ru',
): string {
  const s = S(locale)
  // SMS ≤160 символов — короткие версии, без HTML, ASCII-приоритет.
  switch (type) {
    case 'ai_insights':
      return clip(s.sms_ai(String(payload.headline ?? ''), String(payload.body ?? '')), 160)
    case 'low_inventory': {
      const items = (payload.items as Array<{ name: string }>) ?? []
      return clip(s.sms_low_inv(items.length), 160)
    }
    case 'payment_due_2d':
    case 'payment_due_1d':
    case 'payment_due_today':
    case 'payment_overdue': {
      const when =
        type === 'payment_overdue'
          ? s.sms_overdue
          : type === 'payment_due_today'
            ? s.sms_due_today
            : type === 'payment_due_1d'
              ? s.sms_due_1d
              : s.sms_due_2d
      return clip(
        `${s.sms_brand}: ${when} ${payload.counterparty ?? ''} ${payload.amount_formatted ?? ''}.`,
        160,
      )
    }
    case 'booksy_new_visits':
      return clip(s.sms_booksy(Number(payload.count ?? 0)), 160)
    case 'calendar_conflicts': {
      const conflicts = (payload.conflicts as Array<unknown>) ?? []
      return clip(s.sms_conflict(conflicts.length), 160)
    }
    case 'messenger_new_message':
      return clip(s.sms_new_msg(String(payload.sender ?? '—')), 160)
    case 'weekly_digest':
      return clip(s.sms_weekly, 160)
    case 'daily_digest':
      return clip(s.sms_daily, 160)
    default:
      return clip(s.sms_default, 160)
  }
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

/**
 * Push notification — короткий title + body для service worker'а браузера.
 * url ведёт на соответствующую страницу в app (deep link).
 */
export function renderPush(
  type: NotificationType,
  payload: NotificationPayload,
  locale: Locale = 'ru',
  salonId?: string,
): { title: string; body: string; url: string; tag: string } {
  const s = S(locale)
  const base = `/${salonId ?? ''}`
  switch (type) {
    case 'ai_insights':
      return {
        title: clip(`💡 ${payload.headline ?? s.sms_default}`, 60),
        body: clip(String(payload.body ?? ''), 140),
        url: `${base}/dashboard`,
        tag: `ai-${payload.headline ?? ''}`,
      }
    case 'low_inventory': {
      const items = (payload.items as Array<{ name: string }>) ?? []
      return {
        title: `📦 ${s.sms_low_inv(items.length)}`,
        body: items
          .slice(0, 3)
          .map((i) => i.name)
          .join(', '),
        url: `${base}/inventory`,
        tag: 'low-inventory',
      }
    }
    case 'payment_due_2d':
    case 'payment_due_1d':
    case 'payment_due_today':
    case 'payment_overdue': {
      const when =
        type === 'payment_overdue'
          ? s.sms_overdue
          : type === 'payment_due_today'
            ? s.sms_due_today
            : type === 'payment_due_1d'
              ? s.sms_due_1d
              : s.sms_due_2d
      return {
        title: clip(`💸 ${when}`, 60),
        body: clip(`${payload.counterparty ?? ''} — ${payload.amount_formatted ?? ''}`.trim(), 140),
        url: `${base}/expenses?tab=pending`,
        tag: `payment-${payload.payment_id ?? ''}`,
      }
    }
    case 'booksy_new_visits':
      return {
        title: `📅 ${s.sms_booksy(Number(payload.count ?? 0))}`,
        body: clip(String(payload.summary ?? ''), 140),
        url: `${base}/income?tab=visits`,
        tag: 'booksy-new',
      }
    case 'calendar_conflicts': {
      const conflicts = (payload.conflicts as Array<unknown>) ?? []
      return {
        title: `⚠️ ${s.sms_conflict(conflicts.length)}`,
        body: clip(String(payload.summary ?? ''), 140),
        url: `${base}/income?tab=visits`,
        tag: 'cal-conflicts',
      }
    }
    case 'messenger_new_message':
      return {
        title: `💬 ${s.sms_new_msg(String(payload.sender ?? '—'))}`,
        body: clip(String(payload.preview ?? ''), 140),
        url: `${base}/messenger`,
        tag: `msg-${payload.thread_id ?? ''}`,
      }
    case 'weekly_digest':
      return {
        title: `📊 ${s.sms_weekly}`,
        body: clip(String(payload.summary ?? 'Открой портал чтобы увидеть детали'), 140),
        url: `${base}/dashboard`,
        tag: 'weekly-digest',
      }
    case 'daily_digest':
      return {
        title: `🌅 ${s.sms_daily}`,
        body: clip(String(payload.summary ?? 'Открой портал чтобы увидеть детали'), 140),
        url: `${base}/dashboard`,
        tag: 'daily-digest',
      }
    default:
      return {
        title: 'Finkley',
        body: clip(String(payload.body ?? s.sms_default), 140),
        url: base,
        tag: 'generic',
      }
  }
}
