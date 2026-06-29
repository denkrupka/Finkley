/**
 * claim-setup-reward edge function (ADR-036)
 *
 * Выдаёт награду за прохождение «Настройки Finkley»: одноразовый Stripe
 * promo code на €20 (раньше было «+14 дней демо»). Код применяется юзером
 * при оплате подписки на Stripe Checkout (allow_promotion_codes уже включён).
 *
 * Право (серверная проверка):
 *   1. ВСЕ core-задания настройки выполнены — считаем на СЕРВЕРЕ через RPC
 *      setup_progress(salon): has_visit && has_expense && booksy_connected &&
 *      bank_connected && dashboard_opened. Это совпадает с UI-гейтом
 *      isCoreComplete (apps/web setup-progress.ts). Extra-задания на сервере
 *      не проверяем — они dismissable (пропуск хранится в localStorage клиента,
 *      сервер про него не знает), поэтому «100% всех заданий» = UI-altitude
 *      гейт кнопки, а реальный анти-абуз держим на core + леджере. См. ADR-036.
 *   2. Минимум реальных данных гарантируется core-проверкой (has_visit &&
 *      has_expense входят в core).
 *   3. Один приз на Stripe customer / NIP / аккаунт — UNIQUE-леджер
 *      setup_reward_grants(dedup_key). Insert→catch 23505.
 *   4. Глобальный лимит выдачи (REWARD_MAX_GRANTS) + Sentry-лог.
 *
 * Окно: 30 дней с момента создания салона (раньше было 7 — расширили, т.к.
 * награда стала промокодом, а не продлением триала: меньше срочности, больше
 * шансов довести настройку до конца). См. ADR-036.
 *
 * Контракт ответа: { granted: boolean, code?: string, reason?: string }.
 *   granted=true  → code = промокод (€20), показываем юзеру в UI.
 *   granted=false → reason ∈ {forbidden, already_claimed, window_expired,
 *                   incomplete, limit_reached}.
 *
 * ENV:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY     — для генерации Stripe promo code (live)
 *   REWARD_MAX_GRANTS     (опц., дефолт 100000) — потолок суммарной выдачи
 *   SENTRY_DSN_SERVER     (опц.)
 *
 * POST { salon_id } + Authorization: Bearer <user_jwt>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/notify.ts'
import { grantPromoReward } from '../_shared/promo-reward.ts'
import { pickLocale } from '../_shared/salon-lookup.ts'
import { captureMessage, withSentry } from '../_shared/sentry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'
const REWARD_MAX_GRANTS = Number(Deno.env.get('REWARD_MAX_GRANTS') ?? '100000')
const REWARD_AMOUNT_CENTS = 2000 // €20
const REWARD_CURRENCY = 'eur'
// Окно бонуса €20 — 7 дней с создания салона (owner 2026-06-30, синхронно
// с REWARD_WINDOW_DAYS в apps/web/src/lib/setup-progress.ts).
const WINDOW_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

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

/** ВСЕ задания «Настройки Finkley» выполнены — зеркало isAllComplete из
 *  apps/web/src/lib/setup-progress.ts. owner 2026-06-30: награда €20 теперь
 *  за ВСЕ задания (core + extra), а не только за core. Поля читаем из того же
 *  RPC setup_progress, что и клиент, → клиент и сервер согласованы. */
type SetupProgressRow = {
  has_visit: boolean
  has_expense: boolean
  booksy_connected: boolean
  bank_connected: boolean
  dashboard_opened: boolean
  has_first_client_closed: boolean
  has_expense_calculated: boolean
  has_scheduled_payment: boolean
  bank_synced: boolean
  has_bank_tx_linked: boolean
  has_finance_report: boolean
  has_competitor: boolean
  has_social_page: boolean
  has_google_profile: boolean
  has_inventory_item: boolean
  has_marketing_broadcast: boolean
  has_messenger_message: boolean
  ai_assistant_seen: boolean
  booking_connected: boolean
  any_integration: boolean
}
function isAllComplete(p: SetupProgressRow): boolean {
  return (
    p.has_visit &&
    p.has_expense &&
    p.booksy_connected &&
    p.bank_connected &&
    p.dashboard_opened &&
    p.has_first_client_closed &&
    p.has_expense_calculated &&
    p.has_scheduled_payment &&
    p.bank_synced &&
    p.has_bank_tx_linked &&
    p.has_finance_report &&
    p.has_competitor &&
    p.has_social_page &&
    p.has_google_profile &&
    p.has_inventory_item &&
    p.has_marketing_broadcast &&
    p.has_messenger_message &&
    p.ai_assistant_seen &&
    p.booking_connected &&
    p.any_integration
  )
}

Deno.serve(
  withSentry('claim-setup-reward', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_ROLE || !STRIPE_KEY) {
      return jsonResponse({ error: 'function_not_configured' }, 500)
    }

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

    // Салон + уже выданная награда + NIP (из accounting_settings) + locale.
    const { data: salon, error: salonErr } = await admin
      .from('salons')
      .select(
        'id, name, created_at, locale, country_code, accounting_settings, setup_reward_granted_at',
      )
      .eq('id', salonId)
      .maybeSingle()
    if (salonErr) return jsonResponse({ error: salonErr.message }, 500)
    if (!salon) return jsonResponse({ error: 'salon_not_found' }, 404)

    if (salon.setup_reward_granted_at) {
      return jsonResponse({ granted: false, reason: 'already_claimed' })
    }

    const createdMs = new Date(salon.created_at).getTime()
    const nowMs = Date.now()

    // Окно бонуса €20 — 7 дней с создания салона.
    if (nowMs - createdMs > WINDOW_DAYS * DAY_MS) {
      return jsonResponse({ granted: false, reason: 'window_expired' })
    }

    // Серверная проверка прохождения настройки: ВСЕ задания выполнены.
    const { data: progressRows, error: progressErr } = await admin.rpc('setup_progress', {
      p_salon_id: salonId,
    })
    if (progressErr) return jsonResponse({ error: progressErr.message }, 500)
    const progress = (
      Array.isArray(progressRows) ? progressRows[0] : progressRows
    ) as SetupProgressRow | null
    if (!progress || !isAllComplete(progress)) {
      return jsonResponse({
        granted: false,
        reason: 'incomplete',
        has_visit: progress?.has_visit ?? false,
        has_expense: progress?.has_expense ?? false,
        booksy_connected: progress?.booksy_connected ?? false,
        bank_connected: progress?.bank_connected ?? false,
        dashboard_opened: progress?.dashboard_opened ?? false,
      })
    }

    // Подписка (для dedup-ключа: один приз на Stripe customer).
    const { data: sub } = await admin
      .from('salon_subscriptions')
      .select('id, stripe_customer_id')
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
    // Делаем ДО создания Stripe-промокода — чтобы не плодить купоны при гонке.
    const { error: ledgerErr } = await admin.from('setup_reward_grants').insert({
      salon_id: salonId,
      user_id: user.userId,
      dedup_key: dedupKey,
      bonus_days: 0, // награда теперь промокод, не дни; колонка оставлена для совместимости
    })
    if (ledgerErr) {
      if (ledgerErr.code === '23505') {
        // Этот customer/NIP уже получал приз. Помечаем салон, чтобы не дёргать.
        await admin
          .from('salons')
          .update({ setup_reward_granted_at: new Date().toISOString() })
          .eq('id', salonId)
        return jsonResponse({ granted: false, reason: 'already_claimed' })
      }
      return jsonResponse({ error: ledgerErr.message }, 500)
    }

    // Создаём Stripe promo code €20 + INSERT promo_rewards.
    let code: string
    try {
      const result = await grantPromoReward(admin, STRIPE_KEY, {
        userId: user.userId,
        kind: 'setup',
        amountCents: REWARD_AMOUNT_CENTS,
        currency: REWARD_CURRENCY,
      })
      code = result.code
    } catch (err) {
      // Откатываем леджер, чтобы юзер мог повторить попытку.
      await admin.from('setup_reward_grants').delete().eq('dedup_key', dedupKey)
      throw err
    }

    // Помечаем салон как награждённый (скрывает повторный клик в UI).
    await admin
      .from('salons')
      .update({ setup_reward_granted_at: new Date().toISOString() })
      .eq('id', salonId)

    // Email с промокодом владельцу. Email/имя берём из auth.users по user_id
    // + locale каскадом (profile.locale → salon.locale → country_code → ru).
    const salonRow = salon as {
      name: string
      locale?: string | null
      country_code?: string | null
    }
    const { data: userRes } = await admin.auth.admin.getUserById(user.userId)
    const ownerEmail = userRes?.user?.email ?? ''
    const fullName =
      (userRes?.user?.user_metadata?.full_name as string | undefined) ||
      ownerEmail.split('@')[0] ||
      salonRow.name
    const { data: profile } = await admin
      .from('profiles')
      .select('locale')
      .eq('id', user.userId)
      .maybeSingle()
    const profileLocale = (profile as { locale?: string | null } | null)?.locale
    const locale = pickLocale(profileLocale, salonRow.locale, salonRow.country_code)
    await sendEmail(
      'setup_reward_promo',
      ownerEmail,
      {
        full_name: fullName,
        salon_name: salonRow.name,
        owner_name: 'команда Finkley',
        code,
        amount: '€20',
        billing_url: `${APP_URL}${salonId}/settings`,
      },
      locale,
    )

    await captureMessage('setup_reward promo granted', 'info', {
      fn: 'claim-setup-reward',
      salon_id: salonId,
      dedup_key: dedupKey,
    })

    return jsonResponse({ granted: true, code, amount_cents: REWARD_AMOUNT_CENTS })
  }),
)
