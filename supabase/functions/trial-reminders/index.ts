/**
 * trial-reminders — напоминания об окончании пробного периода.
 *
 * Закрывает дыру: шаблон trial_ending раньше слался ТОЛЬКО по Stripe-событию
 * customer.subscription.trial_will_end, которого у card-less implicit-trial
 * (демо 14 дней без карты, без строки в salon_subscriptions) не бывает —
 * поэтому такие салоны не получали ни одного напоминания.
 *
 * Cron (08:00 UTC, миграция 20260625000001) генерит rendezvous-token и дёргает
 * этот endpoint. Для каждого «живого» салона считаем эффективный дедлайн
 * (max(created_at+14д, trial_ends_at, bonus_until)) и шлём:
 *   - за 3 дня → trial_ending (days_left=3)
 *   - за 1 день → trial_ending (days_left=1)
 *   - в день истечения → trial_expired
 * Идемпотентность: trial_reminder_log UNIQUE(salon_id, kind, deadline_date) —
 * каждый bucket уходит максимум один раз на конкретный дедлайн (insert-then-send,
 * at-most-once). Платные подписки (active/past_due) пропускаем.
 *
 * Auth: deploy --no-verify-jwt, проверка через одноразовый rendezvous-token.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/notify.ts'
import { withSentry } from '../_shared/sentry.ts'
import {
  classifyTrialBucket,
  daysLeftForKind,
  deadlineDateUtc,
  effectiveTrialEndMs,
  isPaidSubscription,
  isTypeEnabled,
  templateForKind,
  type TrialSub,
} from './select.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// База ссылок приложения, напр. https://finkley.app/app/ (со слешем на конце).
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://finkley.app/app/').replace(/\/?$/, '/')

const PREF_KEY = 'trial_ending'

type SubRow = { status: string | null; trial_ends_at: string | null; bonus_until: string | null }

type SalonRow = {
  id: string
  name: string | null
  created_at: string
  currency: string | null
  notification_prefs: Record<string, boolean> | null
  salon_subscriptions: SubRow[] | null
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

/** Локализованная подпись отправителя для {{owner_name}}. */
function senderName(locale: string): string {
  const base = (locale || 'ru').split('-')[0].toLowerCase()
  if (base === 'pl') return 'Zespół Finkley'
  if (base === 'en') return 'Finkley team'
  return 'Команда Finkley'
}

type OwnerRaw = {
  user_id: string
  profiles: { email?: string | null; full_name?: string | null; locale?: string | null } | null
}

async function processOneSalon(
  admin: SupabaseClient,
  salon: SalonRow,
  nowMs: number,
): Promise<{ sent: number; skipped: number }> {
  const stats = { sent: 0, skipped: 0 }

  const sub: TrialSub = salon.salon_subscriptions?.[0] ?? null
  // Платящие клиенты — не на триале.
  if (isPaidSubscription(sub)) return stats

  const effectiveEnd = effectiveTrialEndMs(sub, salon.created_at)
  const kind = classifyTrialBucket(effectiveEnd, nowMs)
  if (!kind) return stats

  if (!isTypeEnabled(salon.notification_prefs, PREF_KEY)) {
    stats.skipped += 1
    return stats
  }

  // Владелец салона + его email/locale.
  const { data: ownerRow } = await admin
    .from('salon_members')
    .select('user_id, profiles!inner(email, full_name, locale)')
    .eq('salon_id', salon.id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  const owner = ownerRow as OwnerRaw | null
  const email = owner?.profiles?.email
  if (!owner || !email) return stats

  const deadlineDate = deadlineDateUtc(effectiveEnd)

  // Идемпотентность: вставляем ДО отправки. 23505 → уже слали этот bucket
  // на этот дедлайн, пропускаем.
  const { error: logErr } = await admin.from('trial_reminder_log').insert({
    salon_id: salon.id,
    user_id: owner.user_id,
    kind,
    deadline_date: deadlineDate,
  })
  if (logErr) {
    if (logErr.code === '23505') {
      stats.skipped += 1
      return stats
    }
    console.warn(`trial_reminder_log insert failed (salon ${salon.id}): ${logErr.message}`)
    return stats
  }

  const locale = owner.profiles?.locale ?? 'ru'
  const template = templateForKind(kind)
  const vars: Record<string, string | number | null> = {
    full_name: owner.profiles?.full_name ?? '',
    salon_name: salon.name ?? 'Salon',
    days_left: daysLeftForKind(kind),
    app_url: `${APP_URL}${salon.id}/dashboard`,
    billing_url: `${APP_URL}${salon.id}/settings?tab=billing`,
    owner_name: senderName(locale),
    // Опциональная статистика по триалу — owner финализирует копирайт шаблона;
    // безопасный neutral-fallback, чтобы письмо не выглядело сломанным.
    visits_during_trial: '—',
    revenue_during_trial: '—',
  }

  await sendEmail(template, email, vars, locale)
  stats.sent += 1
  return stats
}

Deno.serve(
  withSentry('trial-reminders', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY)
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)

    let body: { token?: string; cron?: boolean } = {}
    try {
      body = await req.json()
    } catch {
      // ignore
    }
    if (!body.token) return jsonResponse({ ok: false, error: 'token_required' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // Одноразовый rendezvous-токен (не использован, не истёк).
    const { data: trig, error: trigErr } = await admin
      .from('trial_reminder_triggers')
      .update({ used_at: new Date().toISOString() })
      .eq('token', body.token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('token')
      .maybeSingle()
    if (trigErr || !trig) return jsonResponse({ ok: false, error: 'invalid_or_expired_token' }, 401)

    const nowMs = Date.now()

    // «Живые» салоны: онбординг завершён, не удалены, не заблокированы.
    const { data: salons } = await admin
      .from('salons')
      .select(
        'id, name, created_at, currency, notification_prefs, salon_subscriptions(status, trial_ends_at, bonus_until)',
      )
      .not('onboarding_completed_at', 'is', null)
      .is('deleted_at', null)
      .is('blocked_at', null)

    let totalSent = 0
    let totalSkipped = 0
    for (const s of salons ?? []) {
      try {
        const r = await processOneSalon(admin, s as SalonRow, nowMs)
        totalSent += r.sent
        totalSkipped += r.skipped
      } catch (e) {
        console.warn(`salon ${s.id} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return jsonResponse({ ok: true, sent: totalSent, skipped: totalSkipped })
  }),
)
