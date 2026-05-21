/**
 * sms-billing — обёртка над _shared/sms.ts для салонной отправки.
 *
 * Что делает:
 *   1. Проверяет salons.sms_paused → skip
 *   2. Проверяет salons.sms_balance >= 1 → skip + low-notify
 *   3. Берёт активный sender_name (salons.sms_active_sender_id → salon_sms_senders)
 *      и подставляет вместо SMS_FROM. Если NULL → 'FINKLEY' (общий бесплатный).
 *   4. Шлёт через sendSms (_shared/sms.ts). При успехе — atomic decrement баланса.
 *   5. Логирует строку в sms_send_log (status: sent | failed | skipped_*).
 *   6. Если баланс упал ≤ 2 и сегодня ещё не уведомляли — push владельцу
 *      + plain-text email (Resend). Set sms_low_notified_at = now().
 *
 * Все ошибки только логируются — отправка SMS не должна валить вызывающую
 * функцию (review-request, payment-reminders).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { sendSms } from './sms.ts'
import { sendPushToUser } from './web-push.ts'

const DEFAULT_SENDER = 'FINKLEY'
const LOW_BALANCE_THRESHOLD = 2 // ≤ 2 SMS осталось — шлём уведомление
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Finkley <noreply@finkley.app>'

export type SmsMessageKind = 'review_request' | 'visit_reminder' | 'manual' | 'other'

export type SendSmsForSalonOpts = {
  salonId: string
  to: string
  text: string
  messageType: SmsMessageKind
  clientId?: string | null
}

export type SendSmsForSalonResult = {
  ok: boolean
  status: 'sent' | 'failed' | 'skipped_no_balance' | 'skipped_paused' | 'skipped_provider'
  newBalance?: number
  error?: string
}

type SalonRow = {
  id: string
  name: string
  sms_balance: number
  sms_paused: boolean
  sms_active_sender_id: string | null
  sms_low_notified_at: string | null
  locale: string | null
}

type SenderRow = { sender_name: string; status: string }

/** Главная точка входа — заменяет прямой sendSms() в edge functions. */
export async function sendSmsForSalon(
  admin: SupabaseClient,
  opts: SendSmsForSalonOpts,
): Promise<SendSmsForSalonResult> {
  const { data: salonData, error: salonErr } = await admin
    .from('salons')
    .select('id, name, sms_balance, sms_paused, sms_active_sender_id, sms_low_notified_at, locale')
    .eq('id', opts.salonId)
    .maybeSingle()
  if (salonErr || !salonData) {
    return { ok: false, status: 'failed', error: 'salon_not_found' }
  }
  const salon = salonData as SalonRow

  // Paused — owner toggle. Лог + skip.
  if (salon.sms_paused) {
    await logSendAttempt(admin, opts, salon, null, 'skipped_paused')
    return { ok: false, status: 'skipped_paused' }
  }

  // Балансовая проверка.
  if (salon.sms_balance < 1) {
    await logSendAttempt(admin, opts, salon, null, 'skipped_no_balance')
    // На всякий случай notify — обычно уже notified когда balance стал 2/1/0.
    await maybeNotifyLowBalance(admin, salon, 0)
    return { ok: false, status: 'skipped_no_balance' }
  }

  // Активный sender → имя из salon_sms_senders.sender_name (если active),
  // иначе FINKLEY. Sender передадим в sendSms (опциональный 3-й аргумент).
  let senderName = DEFAULT_SENDER
  if (salon.sms_active_sender_id) {
    const { data: sndr } = await admin
      .from('salon_sms_senders')
      .select('sender_name, status')
      .eq('id', salon.sms_active_sender_id)
      .maybeSingle()
    if (sndr && (sndr as SenderRow).status === 'active') {
      senderName = (sndr as SenderRow).sender_name
    }
  }

  // Реальная отправка.
  const r = await sendSms(opts.to, opts.text, senderName)
  if (!r.ok) {
    // Skipped_provider если провайдер не настроен; failed на остальных ошибках.
    const status: SendSmsForSalonResult['status'] =
      r.error === 'sms_provider_not_configured' ? 'skipped_provider' : 'failed'
    await logSendAttempt(admin, opts, salon, senderName, status, r.error)
    return { ok: false, status, error: r.error }
  }

  // Atomic decrement через RPC-style update; читаем новый баланс.
  const { data: dec, error: decErr } = await admin
    .from('salons')
    .update({ sms_balance: salon.sms_balance - 1 })
    .eq('id', salon.id)
    .eq('sms_balance', salon.sms_balance) // optimistic concurrency
    .select('sms_balance')
    .maybeSingle()
  const newBalance = (dec as { sms_balance: number } | null)?.sms_balance ?? salon.sms_balance - 1
  if (decErr) {
    console.warn('sendSmsForSalon: balance decrement raced —', decErr.message)
  }

  await logSendAttempt(admin, opts, salon, senderName, 'sent', undefined, 1)

  // Если упали ≤ threshold — уведомляем владельца.
  if (newBalance <= LOW_BALANCE_THRESHOLD) {
    await maybeNotifyLowBalance(admin, salon, newBalance)
  }

  return { ok: true, status: 'sent', newBalance }
}

async function logSendAttempt(
  admin: SupabaseClient,
  opts: SendSmsForSalonOpts,
  salon: SalonRow,
  sender: string | null,
  status: SendSmsForSalonResult['status'],
  providerResponse?: string,
  costGrosz = 0,
) {
  try {
    await admin.from('sms_send_log').insert({
      salon_id: salon.id,
      to_phone: opts.to,
      sender,
      body: opts.text.slice(0, 1000),
      message_type: opts.messageType,
      status,
      cost_grosz: costGrosz,
      client_id: opts.clientId ?? null,
      provider_response: providerResponse?.slice(0, 500) ?? null,
    })
  } catch (e) {
    console.warn('sms_send_log insert failed:', e)
  }
}

/**
 * Anti-spam: не чаще 1/день. Идемпотентный update через WHERE
 * (sms_low_notified_at < today). Если update затронул 0 строк — уже notified.
 */
async function maybeNotifyLowBalance(
  admin: SupabaseClient,
  salon: SalonRow,
  newBalance: number,
): Promise<void> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todayIso = today.toISOString()

  const { data: claimed } = await admin
    .from('salons')
    .update({ sms_low_notified_at: new Date().toISOString() })
    .eq('id', salon.id)
    .or(`sms_low_notified_at.is.null,sms_low_notified_at.lt.${todayIso}`)
    .select('id')
    .maybeSingle()
  if (!claimed) return // уже уведомили сегодня

  // Кому отправлять — owner салона (salon_members.role='owner').
  const { data: owner } = await admin
    .from('salon_members')
    .select('user_id')
    .eq('salon_id', salon.id)
    .eq('role', 'owner')
    .maybeSingle()
  const ownerId = (owner as { user_id: string } | null)?.user_id
  if (!ownerId) return

  // Push.
  try {
    await sendPushToUser(admin as unknown as { from: (t: string) => unknown }, ownerId, {
      title: 'SMS заканчиваются',
      body:
        newBalance === 0
          ? `У салона ${salon.name} закончились SMS. Пополните баланс в Настройках → SMS.`
          : `У салона ${salon.name} осталось ${newBalance} SMS. Пополните в Настройках → SMS.`,
      url: '/settings?tab=integrations&sub=sms',
    })
  } catch (e) {
    console.warn('low-balance push failed:', e)
  }

  // Plain-text email через Resend (без HTML template — это служебное уведомление).
  if (!RESEND_API_KEY) return
  const { data: prof } = await admin
    .from('profiles')
    .select('email, locale, full_name')
    .eq('id', ownerId)
    .maybeSingle()
  const profile = prof as {
    email: string | null
    locale: string | null
    full_name: string | null
  } | null
  if (!profile?.email) return

  const locale = (profile.locale ?? salon.locale ?? 'ru').slice(0, 2)
  const { subject, body } = renderLowBalanceEmail(locale, salon.name, newBalance)

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: profile.email,
        subject,
        text: body,
      }),
    })
    if (!r.ok) {
      console.warn('low-balance email failed:', r.status, (await r.text()).slice(0, 200))
    }
  } catch (e) {
    console.warn('low-balance email threw:', e)
  }
}

function renderLowBalanceEmail(
  locale: string,
  salonName: string,
  balance: number,
): { subject: string; body: string } {
  if (locale === 'en') {
    return {
      subject:
        balance === 0 ? `${salonName}: SMS balance is empty` : `${salonName}: low SMS balance`,
      body:
        balance === 0
          ? `Your salon "${salonName}" has run out of SMS. Top up at Settings → Integrations → SMS to keep review requests and visit reminders going.`
          : `Your salon "${salonName}" has only ${balance} SMS left. Top up at Settings → Integrations → SMS.`,
    }
  }
  if (locale === 'pl') {
    return {
      subject: balance === 0 ? `${salonName}: brak SMS na koncie` : `${salonName}: niski stan SMS`,
      body:
        balance === 0
          ? `Twój salon "${salonName}" wyczerpał limit SMS. Doładuj w Ustawienia → Integracje → SMS, aby kontynuować wysyłanie próśb o opinię i przypomnień o wizycie.`
          : `Twojemu salonowi "${salonName}" zostało tylko ${balance} SMS. Doładuj w Ustawienia → Integracje → SMS.`,
    }
  }
  return {
    subject: balance === 0 ? `${salonName}: SMS закончились` : `${salonName}: остаток SMS низкий`,
    body:
      balance === 0
        ? `У вашего салона «${salonName}» закончились SMS. Пополните в Настройках → Интеграции → SMS, чтобы запросы отзывов и напоминания о визитах продолжали уходить.`
        : `У вашего салона «${salonName}» осталось всего ${balance} SMS. Пополните в Настройках → Интеграции → SMS.`,
  }
}
