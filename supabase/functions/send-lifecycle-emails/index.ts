/**
 * send-lifecycle-emails — lifecycle email automation: activation-drip + win-back.
 *
 * Закрывает две дыры воронки (см. migration 20260625000002):
 *   - flow='activation' (cron 08:30 UTC): салон завёл аккаунт ~2-3 дня назад,
 *     но не дошёл до «aha» (визит/расход). Шлём капельную серию (день 2, день 3)
 *     + «забери +14 дней» тем, кто уже добавил визит+расход и почти у цели.
 *   - flow='winback' (cron 09:00 UTC): implicit-trial (демо 14 дней) истёк,
 *     эффективный план стал free, юзер ушёл. На ~день 14-21 после создания
 *     шлём «твои данные на месте, вернись».
 *
 * Дедуп: lifecycle_email_log UNIQUE(salon_id, email_kind) — каждый kind уходит
 * салону максимум один раз за всё время (insert-then-send, at-most-once).
 *
 * Auth: deploy --no-verify-jwt, проверка через одноразовый rendezvous-token
 * (flow-scoped: токен валиден только для своего flow).
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FUNCTION_INTERNAL_SECRET  — для notify.sendEmail
 *   APP_URL                   — база ссылок приложения
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/notify.ts'
import { withSentry } from '../_shared/sentry.ts'
import {
  type ActivationKind,
  decideActivationKind,
  isTrialExpiredForWinback,
} from './eligibility.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// База ссылок приложения, напр. https://finkley.app/app/ (со слешем на конце).
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://finkley.app/app/').replace(/\/?$/, '/')

const DAY_MS = 86_400_000
const REWARD_WINDOW_DAYS = 7

type LifecycleKind = ActivationKind | 'winback_trial'

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

/** Маппинг lifecycle-kind → alias email-шаблона. */
function templateForKind(
  kind: LifecycleKind,
): 'activation_drip_visit' | 'activation_drip_reward' | 'winback_trial' {
  if (kind === 'winback_trial') return 'winback_trial'
  if (kind === 'activation_reward_d3') return 'activation_drip_reward'
  return 'activation_drip_visit'
}

type OwnerRaw = {
  user_id: string
  profiles: { email?: string | null; full_name?: string | null; locale?: string | null } | null
}

type Owner = {
  userId: string
  email: string
  fullName: string
  locale: string
}

/** Резолвит owner'а салона (email/full_name/locale) или null если нет email. */
async function resolveOwner(admin: SupabaseClient, salonId: string): Promise<Owner | null> {
  const { data: ownerRow } = await admin
    .from('salon_members')
    .select('user_id, profiles!inner(email, full_name, locale)')
    .eq('salon_id', salonId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  const owner = ownerRow as OwnerRaw | null
  const email = owner?.profiles?.email
  if (!owner || !email) return null
  return {
    userId: owner.user_id,
    email,
    fullName: owner.profiles?.full_name ?? '',
    locale: owner.profiles?.locale ?? 'ru',
  }
}

/**
 * Идемпотентная отправка одного lifecycle-письма. Вставляет лог-строку ДО
 * отправки: 23505 (уже слали этот kind) → skip. Возвращает true если письмо
 * реально ушло.
 */
async function sendLifecycleEmail(
  admin: SupabaseClient,
  salonId: string,
  owner: Owner,
  kind: LifecycleKind,
  vars: Record<string, string | number | null>,
): Promise<boolean> {
  const { error: logErr } = await admin.from('lifecycle_email_log').insert({
    salon_id: salonId,
    user_id: owner.userId,
    email_kind: kind,
  })
  if (logErr) {
    if (logErr.code === '23505') return false // уже слали — дедуп
    console.warn(`lifecycle_email_log insert failed (salon ${salonId}, ${kind}): ${logErr.message}`)
    return false
  }
  await sendEmail(templateForKind(kind), owner.email, vars, owner.locale)
  return true
}

type SetupProgressRow = {
  has_visit: boolean
  has_expense: boolean
  created_at: string
  reward_granted_at: string | null
}

// =============================================================================
// flow=activation
// =============================================================================

async function handleActivation(
  admin: SupabaseClient,
  nowMs: number,
): Promise<{ sent: number; skipped: number }> {
  const stats = { sent: 0, skipped: 0 }

  // Салоны, созданные ~2-3 дня назад: окно [now-3.5д, now-1.5д].
  const lower = new Date(nowMs - 3.5 * DAY_MS).toISOString()
  const upper = new Date(nowMs - 1.5 * DAY_MS).toISOString()

  const { data: salons } = await admin
    .from('salons')
    .select('id, name, created_at')
    .not('onboarding_completed_at', 'is', null)
    .is('deleted_at', null)
    .is('blocked_at', null)
    .gte('created_at', lower)
    .lte('created_at', upper)

  for (const salon of salons ?? []) {
    try {
      const { data: prog, error: progErr } = await admin
        .rpc('setup_progress', { p_salon_id: salon.id })
        .maybeSingle()
      if (progErr || !prog) continue
      const p = prog as SetupProgressRow

      const ageDays = Math.round(
        (Date.UTC(
          new Date(nowMs).getUTCFullYear(),
          new Date(nowMs).getUTCMonth(),
          new Date(nowMs).getUTCDate(),
        ) -
          Date.UTC(
            new Date(p.created_at).getUTCFullYear(),
            new Date(p.created_at).getUTCMonth(),
            new Date(p.created_at).getUTCDate(),
          )) /
          DAY_MS,
      )

      const kind = decideActivationKind({
        hasVisit: p.has_visit,
        hasExpense: p.has_expense,
        ageDays,
        rewardGranted: p.reward_granted_at != null,
      })
      if (!kind) {
        stats.skipped += 1
        continue
      }

      const owner = await resolveOwner(admin, salon.id)
      if (!owner) {
        stats.skipped += 1
        continue
      }

      // Сколько дней осталось добить настройку на 100% ради награды (>=1).
      const rewardDaysLeft = Math.max(1, REWARD_WINDOW_DAYS - ageDays)

      const vars: Record<string, string | number | null> = {
        full_name: owner.fullName,
        salon_name: salon.name ?? 'Salon',
        reward_days_left: rewardDaysLeft,
        app_url: `${APP_URL}${salon.id}/dashboard`,
        owner_name: senderName(owner.locale),
      }

      const ok = await sendLifecycleEmail(admin, salon.id, owner, kind, vars)
      if (ok) stats.sent += 1
      else stats.skipped += 1
    } catch (e) {
      console.warn(`activation salon ${salon.id} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  return stats
}

// =============================================================================
// flow=winback
// =============================================================================

type SubRow = { status: string | null; trial_ends_at: string | null; bonus_until: string | null }

type WinbackSalonRow = {
  id: string
  name: string | null
  created_at: string
  salon_subscriptions: SubRow[] | null
}

async function handleWinback(
  admin: SupabaseClient,
  nowMs: number,
): Promise<{ sent: number; skipped: number }> {
  const stats = { sent: 0, skipped: 0 }

  // Салоны, созданные ~14-21 день назад (триал истёк недавно).
  const lower = new Date(nowMs - 21 * DAY_MS).toISOString()
  const upper = new Date(nowMs - 14 * DAY_MS).toISOString()

  const { data: salons } = await admin
    .from('salons')
    .select('id, name, created_at, salon_subscriptions(status, trial_ends_at, bonus_until)')
    .not('onboarding_completed_at', 'is', null)
    .is('deleted_at', null)
    .is('blocked_at', null)
    .gte('created_at', lower)
    .lte('created_at', upper)

  for (const s of (salons ?? []) as WinbackSalonRow[]) {
    try {
      const sub = s.salon_subscriptions?.[0] ?? null
      const expired = isTrialExpiredForWinback({
        status: sub?.status,
        trialEndsAt: sub?.trial_ends_at,
        bonusUntil: sub?.bonus_until,
        createdAtMs: Date.parse(s.created_at),
        nowMs,
      })
      if (!expired) {
        stats.skipped += 1
        continue
      }

      const owner = await resolveOwner(admin, s.id)
      if (!owner) {
        stats.skipped += 1
        continue
      }

      const vars: Record<string, string | number | null> = {
        full_name: owner.fullName,
        salon_name: s.name ?? 'Salon',
        app_url: `${APP_URL}${s.id}/dashboard`,
        billing_url: `${APP_URL}${s.id}/settings?tab=billing`,
        owner_name: senderName(owner.locale),
      }

      const ok = await sendLifecycleEmail(admin, s.id, owner, 'winback_trial', vars)
      if (ok) stats.sent += 1
      else stats.skipped += 1
    } catch (e) {
      console.warn(`winback salon ${s.id} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  return stats
}

// =============================================================================
// Entry
// =============================================================================

Deno.serve(
  withSentry('send-lifecycle-emails', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY)
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)

    let body: { token?: string; flow?: string; cron?: boolean } = {}
    try {
      body = await req.json()
    } catch {
      // ignore
    }
    if (!body.token) return jsonResponse({ ok: false, error: 'token_required' }, 401)
    if (body.flow !== 'activation' && body.flow !== 'winback')
      return jsonResponse({ ok: false, error: 'invalid_flow' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Одноразовый flow-scoped rendezvous-токен (не использован, не истёк).
    const { data: trig, error: trigErr } = await admin
      .from('lifecycle_email_triggers')
      .update({ used_at: new Date().toISOString() })
      .eq('token', body.token)
      .eq('flow', body.flow)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('token')
      .maybeSingle()
    if (trigErr || !trig) return jsonResponse({ ok: false, error: 'invalid_or_expired_token' }, 401)

    const nowMs = Date.now()
    const stats =
      body.flow === 'activation'
        ? await handleActivation(admin, nowMs)
        : await handleWinback(admin, nowMs)

    return jsonResponse({ ok: true, flow: body.flow, ...stats })
  }),
)
