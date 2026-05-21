/**
 * SMSAPI sender names API.
 *
 * SMSAPI берёт ~99 zł за регистрацию sender (одноразово на имя). Юзер
 * сам платит нам 100 zł через Stripe, после оплаты дёргаем этот helper.
 *
 * Документация: https://www.smsapi.pl/docs/#sendernames
 *
 * Flow:
 *   1. POST /sms/sendernames {name} → SMSAPI создаёт sender, статус
 *      PENDING_APPROVAL (модерация SMSAPI ~часы-дни).
 *   2. GET  /sms/sendernames/{name} → проверка статуса.
 *   3. Когда APPROVED — sender можно использовать в from-поле sms.do.
 */

const API_BASE = 'https://api.smsapi.com'

export type SmsApiSenderStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'UNKNOWN'

export type SmsApiSenderResult =
  | { ok: true; status: SmsApiSenderStatus; raw: unknown }
  | { ok: false; error: string; status?: number }

function apiKey(): string {
  return Deno.env.get('SMS_API_KEY') ?? ''
}

/**
 * Создать новый sender name в SMSAPI. После успеха возвращает status
 * (обычно PENDING_APPROVAL — нужно ждать модерации).
 */
export async function createSmsApiSender(name: string): Promise<SmsApiSenderResult> {
  const key = apiKey()
  if (!key) return { ok: false, error: 'sms_api_key_missing' }
  const r = await fetch(`${API_BASE}/sms/sendernames`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  const text = await r.text()
  if (!r.ok) {
    return { ok: false, error: text.slice(0, 300), status: r.status }
  }
  try {
    const j = JSON.parse(text) as { status?: string }
    const status = normalizeStatus(j.status)
    return { ok: true, status, raw: j }
  } catch {
    return { ok: false, error: 'invalid_json_response' }
  }
}

/** Проверить актуальный статус sender'а в SMSAPI. */
export async function getSmsApiSenderStatus(name: string): Promise<SmsApiSenderResult> {
  const key = apiKey()
  if (!key) return { ok: false, error: 'sms_api_key_missing' }
  const r = await fetch(`${API_BASE}/sms/sendernames/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  const text = await r.text()
  if (!r.ok) {
    return { ok: false, error: text.slice(0, 300), status: r.status }
  }
  try {
    const j = JSON.parse(text) as { status?: string }
    return { ok: true, status: normalizeStatus(j.status), raw: j }
  } catch {
    return { ok: false, error: 'invalid_json_response' }
  }
}

function normalizeStatus(s: string | undefined): SmsApiSenderStatus {
  const up = (s ?? '').toUpperCase()
  if (up === 'APPROVED' || up === 'ACTIVE') return 'APPROVED'
  if (up === 'REJECTED' || up === 'BLOCKED') return 'REJECTED'
  if (up === 'PENDING_APPROVAL' || up === 'PENDING') return 'PENDING_APPROVAL'
  return 'UNKNOWN'
}

/**
 * Валидация имени по правилам SMSAPI/GSM:
 *   - 3–11 символов
 *   - только A-Z, a-z, 0-9 (без пробелов/спецсимволов)
 *   - хотя бы 1 буква (чтоб не было чисто цифр — Польша считает их числовыми)
 */
export function validateSenderName(name: string): { ok: boolean; error?: string } {
  if (!name || name.length < 3 || name.length > 11) {
    return { ok: false, error: 'length_3_to_11' }
  }
  if (!/^[A-Za-z0-9]+$/.test(name)) {
    return { ok: false, error: 'alphanumeric_only' }
  }
  if (!/[A-Za-z]/.test(name)) {
    return { ok: false, error: 'must_contain_letter' }
  }
  return { ok: true }
}
