/**
 * SMS provider scaffold.
 *
 * Поддерживает несколько провайдеров через env:
 *   - SMS_PROVIDER = 'smsapi' | 'flysms' | 'twilio' | 'none' (default 'none' → silent skip)
 *   - SMS_API_KEY / SMS_API_SECRET / SMS_FROM — креды провайдера
 *
 * Если SMS_PROVIDER не задан или равен 'none' — функция возвращает false без
 * сетевых вызовов. Это позволяет callers слать SMS не блокирующим способом —
 * если provider не подключён, просто шлётся только email.
 *
 * SMSAPI (smsapi.com — польский провайдер): POST https://api.smsapi.com/sms.do
 *   Auth: Bearer <oauth_token> (через SMS_API_KEY).
 *   Form-encoded: to, message, from, format=json.
 *
 * FlySMS API: POST https://api.flysms.com/v1/send
 *   body: { phone, message, api_key }
 *
 * Twilio: POST https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json
 *   form-encoded: To, From, Body. Basic auth Account SID + Auth Token.
 */

export type SmsResult = { ok: boolean; provider?: string; error?: string }

export async function sendSms(
  to: string,
  text: string,
  /** Перебивает SMS_FROM env (используется sms-billing для активного sender салона). */
  senderOverride?: string,
): Promise<SmsResult> {
  const provider = (Deno.env.get('SMS_PROVIDER') ?? 'none').toLowerCase()
  if (provider === 'none' || !provider) {
    return { ok: false, error: 'sms_provider_not_configured' }
  }
  const phone = normalizePhone(to)
  if (!phone) {
    return { ok: false, error: 'invalid_phone' }
  }

  try {
    if (provider === 'smsapi') return await sendViaSmsApi(phone, text, senderOverride)
    if (provider === 'flysms') return await sendViaFlySms(phone, text, senderOverride)
    if (provider === 'twilio') return await sendViaTwilio(phone, text, senderOverride)
    return { ok: false, error: `unknown_provider:${provider}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Нормализация телефона в E.164 формат. Принимает «+48 123 456 789» и подобное. */
function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned) return null
  // Если нет «+», добавляем (FlySMS требует E.164).
  if (!cleaned.startsWith('+')) {
    // Если начинается с 48 / 380 / 7 — добавим plus. Иначе как есть.
    if (/^(48|380|7|49|33|34|39|420|370|371|372|358|31)/.test(cleaned)) {
      return `+${cleaned}`
    }
    return null
  }
  return cleaned
}

/**
 * SMSAPI (smsapi.com / smsapi.pl) — польский провайдер.
 * Использует OAuth-токен из SMS_API_KEY как Bearer. SMS_FROM — sender name
 * (требует регистрации в SMSAPI; по умолчанию `Test` для песочницы).
 * Returns 200 + JSON {count, list, message} при успехе.
 */
async function sendViaSmsApi(
  phone: string,
  text: string,
  senderOverride?: string,
): Promise<SmsResult> {
  const apiKey = Deno.env.get('SMS_API_KEY') ?? ''
  if (!apiKey) return { ok: false, error: 'smsapi_no_api_key' }
  // SMSAPI имеет 2 региона: .com (international) и .pl (Польша).
  // Токены, созданные на ssl.smsapi.pl Dashboard, работают ТОЛЬКО на .pl
  // endpoint (на .com дают 401 authorization_failed). По умолчанию — .pl,
  // т.к. наш основной рынок PL и SMSAPI чаще регистрируются там.
  const base =
    Deno.env.get('SMS_API_REGION') === 'com' ? 'https://api.smsapi.com' : 'https://api.smsapi.pl'
  // SMSAPI принимает номер БЕЗ «+» (E.164 без префикса), так что снимаем его.
  const cleanedPhone = phone.startsWith('+') ? phone.slice(1) : phone
  const form = new URLSearchParams({
    to: cleanedPhone,
    message: text,
    from: senderOverride ?? Deno.env.get('SMS_FROM') ?? 'Test',
    format: 'json',
    encoding: 'utf-8',
  })
  const r = await fetch(`${base}/sms.do`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const body = await r.text()
  if (!r.ok) {
    return { ok: false, provider: 'smsapi', error: `http_${r.status}:${body.slice(0, 200)}` }
  }
  // SMSAPI возвращает 200 даже на ошибки уровня приложения (errcode, message).
  try {
    const data = JSON.parse(body) as { error?: number; message?: string; count?: number }
    if (data.error) {
      return {
        ok: false,
        provider: 'smsapi',
        error: `smsapi_${data.error}:${data.message ?? ''}`.slice(0, 200),
      }
    }
  } catch {
    // Не-JSON в 200 — считаем успехом (sandbox/тест).
  }
  return { ok: true, provider: 'smsapi' }
}

async function sendViaFlySms(
  phone: string,
  text: string,
  senderOverride?: string,
): Promise<SmsResult> {
  const apiKey = Deno.env.get('SMS_API_KEY') ?? ''
  if (!apiKey) return { ok: false, error: 'flysms_no_api_key' }
  const r = await fetch('https://api.flysms.com/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      phone,
      message: text,
      from: senderOverride ?? Deno.env.get('SMS_FROM') ?? 'Finkley',
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    return { ok: false, provider: 'flysms', error: `http_${r.status}:${body.slice(0, 200)}` }
  }
  return { ok: true, provider: 'flysms' }
}

async function sendViaTwilio(
  phone: string,
  text: string,
  senderOverride?: string,
): Promise<SmsResult> {
  const sid = Deno.env.get('SMS_API_KEY') ?? '' // Twilio Account SID
  const token = Deno.env.get('SMS_API_SECRET') ?? '' // Twilio Auth Token
  const from = senderOverride ?? Deno.env.get('SMS_FROM') ?? ''
  if (!sid || !token || !from) return { ok: false, error: 'twilio_creds_missing' }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const form = new URLSearchParams({ To: phone, From: from, Body: text })
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  if (!r.ok) {
    const body = await r.text()
    return { ok: false, provider: 'twilio', error: `http_${r.status}:${body.slice(0, 200)}` }
  }
  return { ok: true, provider: 'twilio' }
}
