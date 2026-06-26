/**
 * phone-verify — SMS-подтверждение номера телефона юзера на шаге онбординга
 * «Связь». Чтобы чужой/опечатанный номер не записался по ошибке.
 *
 * Auth: Bearer <user JWT> → admin.auth.getUser(jwt). Без членства в салоне —
 * подтверждается личный профиль юзера (profiles.phone), не салонный ресурс.
 *
 * Body: { action: 'send' | 'verify', phone, code? }
 *   - 'send':   нормализует телефон в E.164, генерит 6-значный код, хранит
 *               SHA-256 хэш в phone_verification_codes (заменяя прошлый код
 *               юзера), шлёт SMS через _shared/sms.ts (прямой провайдер из env,
 *               НЕ салонный SMS-баланс — на онбординге салон может быть без
 *               настроенного биллинга). Rate-limit: не чаще 1 SMS / 60 сек.
 *               → { ok, sent }
 *   - 'verify': берёт последний не истёкший код юзера (attempts < 5), сверяет
 *               хэш. Успех → profiles.phone = <phone>, phone_verified_at = now(),
 *               код удаляется → { ok: true, verified: true }. Неверно →
 *               attempts++ → { ok: false }.
 *
 * Код в БД — только хэш, plaintext НИКОГДА не возвращается клиенту и не логируется.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { withSentry } from '../_shared/sentry.ts'
import { normalizePhone, sendSms } from '../_shared/sms.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CODE_TTL_MS = 10 * 60 * 1000 // 10 минут (совпадает с default в миграции)
const RESEND_COOLDOWN_MS = 60 * 1000 // не чаще 1 SMS / 60 сек
const MAX_ATTEMPTS = 5

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 6-значный код, равномерно по [000000, 999999]. */
function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000
  return n.toString().padStart(6, '0')
}

type Body = { action?: 'send' | 'verify'; phone?: string; code?: string }

Deno.serve(
  withSentry('phone-verify', async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: 'not_configured' }, 500)

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401)

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ ok: false, error: 'bad_request' }, 400)

    const phone = normalizePhone(body.phone ?? '')
    if (!phone) return json({ ok: false, error: 'invalid_phone' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData?.user) return json({ ok: false, error: 'unauthorized' }, 401)
    const userId = userData.user.id

    // -------------------------------------------------------------------------
    // action: send
    // -------------------------------------------------------------------------
    if (body.action === 'send') {
      // Rate-limit: смотрим время последнего кода юзера.
      const { data: last } = await admin
        .from('phone_verification_codes')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (last?.created_at) {
        const elapsed = Date.now() - new Date(last.created_at as string).getTime()
        if (elapsed < RESEND_COOLDOWN_MS) {
          const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)
          return json({ ok: false, error: 'rate_limited', retry_after: retryAfter }, 429)
        }
      }

      const code = generateCode()
      const codeHash = await sha256Hex(code)

      // Один активный код на юзера — удаляем прошлые, вставляем новый.
      await admin.from('phone_verification_codes').delete().eq('user_id', userId)
      const { error: insErr } = await admin.from('phone_verification_codes').insert({
        user_id: userId,
        phone,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        attempts: 0,
      })
      if (insErr) return json({ ok: false, error: 'db_error' }, 500)

      const text = `Finkley: kod potwierdzenia ${code}. Wazny 10 minut.`
      const sms = await sendSms(phone, text)
      if (!sms.ok) {
        // Код уже в БД — но SMS не ушёл. Чистим, чтобы не висел мёртвый код,
        // и сообщаем клиенту что провайдер не настроен / отклонил.
        await admin.from('phone_verification_codes').delete().eq('user_id', userId)
        return json({ ok: false, sent: false, error: sms.error ?? 'sms_failed' }, 502)
      }

      return json({ ok: true, sent: true })
    }

    // -------------------------------------------------------------------------
    // action: verify
    // -------------------------------------------------------------------------
    if (body.action === 'verify') {
      const code = (body.code ?? '').trim()
      if (!/^\d{4,8}$/.test(code)) return json({ ok: false, error: 'bad_code' }, 400)

      const { data: row } = await admin
        .from('phone_verification_codes')
        .select('id, phone, code_hash, attempts, expires_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!row) return json({ ok: false, error: 'no_code' }, 400)
      if (new Date(row.expires_at as string).getTime() < Date.now()) {
        await admin.from('phone_verification_codes').delete().eq('id', row.id)
        return json({ ok: false, error: 'expired' }, 400)
      }
      if ((row.attempts as number) >= MAX_ATTEMPTS) {
        await admin.from('phone_verification_codes').delete().eq('id', row.id)
        return json({ ok: false, error: 'too_many_attempts' }, 429)
      }

      const codeHash = await sha256Hex(code)
      const matches = codeHash === (row.code_hash as string) && (row.phone as string) === phone

      if (!matches) {
        await admin
          .from('phone_verification_codes')
          .update({ attempts: (row.attempts as number) + 1 })
          .eq('id', row.id)
        return json({ ok: false, verified: false, error: 'mismatch' })
      }

      // Успех — фиксируем телефон + подтверждённость, чистим код.
      const { error: upErr } = await admin
        .from('profiles')
        .update({ phone, phone_verified_at: new Date().toISOString() })
        .eq('id', userId)
      if (upErr) return json({ ok: false, error: 'db_error' }, 500)

      await admin.from('phone_verification_codes').delete().eq('id', row.id)
      return json({ ok: true, verified: true })
    }

    return json({ ok: false, error: 'unknown_action' }, 400)
  }),
)
