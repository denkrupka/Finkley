/**
 * claim-setup-reward edge function
 *
 * Выдаёт награду «+14 дней демо» за прохождение «Настройки Finkley» на 100%
 * в течение 7 дней с момента создания салона.
 *
 * Защита от абуза (см. требования владельца):
 *   1. Completion считается на СЕРВЕРЕ из реальных событий — функция сама
 *      проверяет >=1 визит И >=1 расход (минимум реальных данных).
 *   2. Один приз на Stripe customer / NIP (а не на аккаунт) — дедуп через
 *      UNIQUE-леджер setup_reward_grants(dedup_key). Insert→catch 23505.
 *   3. Глобальный лимит выдачи (REWARD_MAX_GRANTS) + Sentry-лог каждого
 *      гранта и достижения лимита.
 *
 * Грант = salon_subscriptions.bonus_until (механизм ручного продления,
 * миграция 20260514150000). Работает и для implicit-trial салонов, и поверх
 * Stripe-триала, без обращения к Stripe API.
 *
 * ENV:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   REWARD_MAX_GRANTS  (опц., дефолт 100000) — потолок суммарной выдачи
 *   SENTRY_DSN_SERVER  (опц.)
 *
 * POST { salon_id } + Authorization: Bearer <user_jwt>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { captureMessage, withSentry } from '../_shared/sentry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const REWARD_MAX_GRANTS = Number(Deno.env.get('REWARD_MAX_GRANTS') ?? '100000')
const REWARD_DAYS = 14
const WINDOW_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const IMPLICIT_TRIAL_DAYS = 14

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

/** PL NIP = 10 цифр. Нормализуем к цифрам; короче 10 — считаем отсутствующим. */
function normalizeNip(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 10 ? digits : null
}

Deno.serve(
  withSentry('claim-setup-reward', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_ROLE)
      return jsonResponse({ error: 'function_not_configured' }, 500)

    const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_ROLE)
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

    let body: { salon_id?: string; salonId?: string }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }
    const salonId = body.salon_id ?? body.salonId
    if (!salonId) return jsonResponse({ error: 'salon_id_required' }, 400)

    // Только owner может забрать награду салона.
    const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salonId)
    if (!membership || membership.role !== 'owner') {
      return jsonResponse({ granted: false, reason: 'forbidden' }, 403)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Салон + уже выданная награда + NIP (из accounting_settings).
    const { data: salon, error: salonErr } = await admin
      .from('salons')
      .select('id, created_at, accounting_settings, setup_reward_granted_at')
      .eq('id', salonId)
      .maybeSingle()
    if (salonErr) return jsonResponse({ error: salonErr.message }, 500)
    if (!salon) return jsonResponse({ error: 'salon_not_found' }, 404)

    if (salon.setup_reward_granted_at) {
      return jsonResponse({ granted: false, reason: 'already_claimed' })
    }

    const createdMs = new Date(salon.created_at).getTime()
    const nowMs = Date.now()

    // Окно 7 дней с создания салона.
    if (nowMs - createdMs > WINDOW_DAYS * DAY_MS) {
      return jsonResponse({ granted: false, reason: 'window_expired' })
    }

    // Минимум реальных данных: >=1 визит И >=1 расход (серверная проверка).
    const [visitRes, expenseRes] = await Promise.all([
      admin
        .from('visits')
        .select('id', { count: 'exact', head: true })
        .eq('salon_id', salonId)
        .is('deleted_at', null),
      admin
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('salon_id', salonId)
        .is('deleted_at', null),
    ])
    const hasVisit = (visitRes.count ?? 0) > 0
    const hasExpense = (expenseRes.count ?? 0) > 0
    if (!hasVisit || !hasExpense) {
      return jsonResponse({ granted: false, reason: 'incomplete', hasVisit, hasExpense })
    }

    // Подписка (для dedup-ключа и расчёта конца доступа).
    const { data: sub } = await admin
      .from('salon_subscriptions')
      .select('id, status, trial_ends_at, current_period_end, bonus_until, stripe_customer_id')
      .eq('salon_id', salonId)
      .maybeSingle()

    // dedup_key: один приз на Stripe customer / NIP / (fallback) аккаунт-владельца.
    let dedupKey: string
    const nip = normalizeNip((salon.accounting_settings as Record<string, unknown> | null)?.nip)
    if (sub?.stripe_customer_id) dedupKey = `cus:${sub.stripe_customer_id}`
    else if (nip) dedupKey = `nip:${nip}`
    else dedupKey = `user:${user.userId}`

    // Глобальный лимит выдачи (анти-абуз). Sentry-лог при достижении.
    const { count: grantsCount } = await admin
      .from('setup_reward_grants')
      .select('id', { count: 'exact', head: true })
    if ((grantsCount ?? 0) >= REWARD_MAX_GRANTS) {
      await captureMessage('setup_reward limit reached', 'warning', {
        fn: 'claim-setup-reward',
        salon_id: salonId,
        grants: grantsCount,
        max: REWARD_MAX_GRANTS,
      })
      return jsonResponse({ granted: false, reason: 'limit_reached' })
    }

    // Идемпотентная вставка в леджер: UNIQUE(dedup_key) → 23505 = уже выдано.
    const { error: ledgerErr } = await admin.from('setup_reward_grants').insert({
      salon_id: salonId,
      user_id: user.userId,
      dedup_key: dedupKey,
      bonus_days: REWARD_DAYS,
    })
    if (ledgerErr) {
      if (ledgerErr.code === '23505') {
        // Этот customer/NIP уже получал приз (возможно на другой аккаунт/салон).
        // Помечаем салон, чтобы не дёргать повторно.
        await admin
          .from('salons')
          .update({ setup_reward_granted_at: new Date().toISOString() })
          .eq('id', salonId)
        return jsonResponse({ granted: false, reason: 'already_claimed' })
      }
      return jsonResponse({ error: ledgerErr.message }, 500)
    }

    // Конец доступа = max(сейчас, implicit-trial, trial_ends_at,
    // current_period_end, bonus_until) + 14 дней.
    const candidates = [
      nowMs,
      createdMs + IMPLICIT_TRIAL_DAYS * DAY_MS,
      sub?.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : 0,
      sub?.current_period_end ? new Date(sub.current_period_end).getTime() : 0,
      sub?.bonus_until ? new Date(sub.bonus_until).getTime() : 0,
    ].filter((n) => Number.isFinite(n) && n > 0)
    const baseMs = Math.max(...candidates)
    const newEndIso = new Date(baseMs + REWARD_DAYS * DAY_MS).toISOString()

    if (sub) {
      const { error } = await admin
        .from('salon_subscriptions')
        .update({ bonus_until: newEndIso, granted_reason: 'setup_reward' })
        .eq('id', sub.id)
      if (error) return jsonResponse({ error: error.message }, 500)
    } else {
      const { error } = await admin.from('salon_subscriptions').insert({
        salon_id: salonId,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        status: 'trialing',
        trial_ends_at: newEndIso,
        current_period_start: new Date(nowMs).toISOString(),
        current_period_end: newEndIso,
        source: 'manual_admin',
        bonus_until: newEndIso,
        granted_reason: 'setup_reward',
      })
      if (error) return jsonResponse({ error: error.message }, 500)
    }

    await admin
      .from('salons')
      .update({ setup_reward_granted_at: new Date().toISOString() })
      .eq('id', salonId)

    await captureMessage('setup_reward granted', 'info', {
      fn: 'claim-setup-reward',
      salon_id: salonId,
      dedup_key: dedupKey,
      bonus_until: newEndIso,
    })

    return jsonResponse({ granted: true, bonus_days: REWARD_DAYS, bonus_until: newEndIso })
  }),
)
