/**
 * Общий хелпер выдачи одноразовой Stripe промо-награды (ADR-036).
 *
 * Используется из:
 *   - claim-setup-reward  → kind='setup',   €20 за «Настройку Finkley»
 *   - stripe-webhook      → kind='referral', €15 рефереру за первую платную
 *                            подписку приглашённого.
 *
 * Поток:
 *   1. createOneTimePromoCode (Stripe coupon + promotion_code).
 *   2. INSERT promo_rewards (леджер + код для UI + трекинг email/redeem).
 *   3. Возврат { code, promoRewardId } вызывающему (он шлёт email).
 *
 * Идемпотентность:
 *   - referral: если promo_rewards с этим referral_use_id уже есть — возвращаем
 *     существующий (UNIQUE(referral_use_id) гарантирует один на use). НЕ плодим
 *     купоны в Stripe.
 *   - setup: дедуп на стороне вызывающего (UNIQUE-леджер setup_reward_grants),
 *     сюда попадаем только когда грант реально нужно создать.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { createOneTimePromoCode } from './stripe.ts'

export type PromoRewardKind = 'setup' | 'referral'

export type GrantPromoRewardResult = {
  code: string
  promoRewardId: string
  /** true, если награда уже существовала (idempotent re-entry). */
  reused: boolean
}

export async function grantPromoReward(
  admin: SupabaseClient,
  secret: string,
  input: {
    userId: string
    kind: PromoRewardKind
    amountCents: number
    currency?: string
    /** Обязателен для kind='referral' (дедуп + связь). */
    referralUseId?: string | null
  },
): Promise<GrantPromoRewardResult> {
  const currency = (input.currency ?? 'eur').toLowerCase()

  // Idempotent re-entry для referral: уже выдавали по этому use → вернуть его.
  if (input.kind === 'referral' && input.referralUseId) {
    const { data: existing } = await admin
      .from('promo_rewards')
      .select('id, code')
      .eq('referral_use_id', input.referralUseId)
      .maybeSingle()
    const ex = existing as { id: string; code: string | null } | null
    if (ex?.code) {
      return { code: ex.code, promoRewardId: ex.id, reused: true }
    }
  }

  const promo = await createOneTimePromoCode(secret, {
    amountOffCents: input.amountCents,
    currency,
    name: input.kind === 'setup' ? 'Finkley setup reward' : 'Finkley referral reward',
    metadata: {
      kind: input.kind,
      user_id: input.userId,
      ...(input.referralUseId ? { referral_use_id: input.referralUseId } : {}),
    },
  })

  const { data: inserted, error } = await admin
    .from('promo_rewards')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      amount_cents: input.amountCents,
      currency,
      stripe_coupon_id: promo.couponId,
      stripe_promo_code_id: promo.promoCodeId,
      code: promo.code,
      referral_use_id: input.referralUseId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // Гонка: параллельный вызов уже вставил referral-награду (UNIQUE 23505).
    // Купон в Stripe «лишний» (max_redemptions=1, безвреден) — берём существующий.
    if (error.code === '23505' && input.kind === 'referral' && input.referralUseId) {
      const { data: race } = await admin
        .from('promo_rewards')
        .select('id, code')
        .eq('referral_use_id', input.referralUseId)
        .maybeSingle()
      const r = race as { id: string; code: string | null } | null
      if (r?.code) return { code: r.code, promoRewardId: r.id, reused: true }
    }
    throw new Error(`promo_rewards insert failed: ${error.message}`)
  }

  return { code: promo.code, promoRewardId: (inserted as { id: string }).id, reused: false }
}
