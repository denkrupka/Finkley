/**
 * Pure eligibility logic for send-lifecycle-emails (activation-drip + win-back).
 *
 * НЕТ импортов Deno/Supabase — модуль юнит-тестируется в vitest
 * (см. eligibility.test.ts). Вся арифметика дат — в UTC-днях.
 *
 * Контекст:
 *   - Activation: салон завёл аккаунт, но не дошёл до «aha» (первый визит/
 *     расход). decideActivationKind зеркалит setup_progress (has_visit/
 *     has_expense/created_at/reward_granted_at) + окно награды (ADR-034:
 *     REWARD_WINDOW_DAYS=7).
 *   - Win-back: implicit-trial (демо 14 дней без карты, нет строки в
 *     salon_subscriptions) закончился — эффективный план стал 'free'.
 *     isTrialExpiredForWinback зеркалит entitlements.effectivePlan==='free'
 *     (DEMO_TRIAL_DAYS=14).
 */

const DAY_MS = 86_400_000

/** Должно совпадать с REWARD_WINDOW_DAYS (apps/web/src/lib/setup-progress.ts, ADR-034). */
export const REWARD_WINDOW_DAYS = 7
/** Должно совпадать с DEMO_TRIAL_DAYS (apps/web/src/lib/entitlements.ts). */
export const DEMO_TRIAL_DAYS = 14

export type ActivationKind = 'activation_visit_d2' | 'activation_visit_d3' | 'activation_reward_d3'

/**
 * Целое число прошедших UTC-дней с момента создания салона до now.
 * created_at 2д назад (по UTC-полуночи) → 2. Невалидная дата → -1.
 */
export function ageDaysUtc(createdAtIso: string, nowMs: number): number {
  const createdMs = Date.parse(createdAtIso)
  if (!Number.isFinite(createdMs)) return -1
  const created = new Date(createdMs)
  const now = new Date(nowMs)
  const createdMidnight = Date.UTC(
    created.getUTCFullYear(),
    created.getUTCMonth(),
    created.getUTCDate(),
  )
  const nowMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((nowMidnight - createdMidnight) / DAY_MS)
}

/**
 * Какое activation-письмо (если вообще) слать салону сегодня.
 *
 *   - rewardGranted → null (награда уже выдана, не теребим).
 *   - !hasVisit && ageDays===2                       → activation_visit_d2
 *   - (!hasVisit || !hasExpense) && ageDays===3       → activation_visit_d3
 *   - hasVisit && hasExpense && ageDays===3 (<=окно)  → activation_reward_d3
 *   - иначе null.
 *
 * Cron гоняется раз в день, поэтому салон попадает в каждый bucket ровно раз;
 * дедуп по email_kind в lifecycle_email_log закрывает повторы при ретраях.
 */
export function decideActivationKind(input: {
  hasVisit: boolean
  hasExpense: boolean
  ageDays: number
  rewardGranted: boolean
}): ActivationKind | null {
  const { hasVisit, hasExpense, ageDays, rewardGranted } = input
  if (rewardGranted) return null

  if (!hasVisit && ageDays === 2) return 'activation_visit_d2'

  if ((!hasVisit || !hasExpense) && ageDays === 3) return 'activation_visit_d3'

  if (hasVisit && hasExpense && ageDays === 3 && ageDays <= REWARD_WINDOW_DAYS) {
    return 'activation_reward_d3'
  }

  return null
}

export type WinbackSub =
  | {
      status?: string | null
      trial_ends_at?: string | null
      bonus_until?: string | null
    }
  | null
  | undefined

/**
 * Истёк ли пробный период так, что салон сейчас на free → кандидат на win-back.
 * Зеркалит entitlements.effectivePlan === 'free':
 *   НЕТ active/past_due платной подписки
 *   И НЕТ действующего бонуса (bonus_until > now)
 *   И НЕТ действующего триала (status==='trialing' && trial_ends_at > now)
 *   И implicit-trial истёк (createdAtMs < now - 14д).
 */
export function isTrialExpiredForWinback(input: {
  status?: string | null
  trialEndsAt?: string | null
  bonusUntil?: string | null
  createdAtMs: number
  nowMs: number
}): boolean {
  const { status, trialEndsAt, bonusUntil, createdAtMs, nowMs } = input

  // Платящий клиент — не win-back.
  if (status === 'active' || status === 'past_due') return false

  // Действующий бонус → ещё в доступе.
  if (bonusUntil) {
    const bonusMs = Date.parse(bonusUntil)
    if (Number.isFinite(bonusMs) && bonusMs > nowMs) return false
  }

  // Действующий Stripe-триал → ещё в доступе.
  if (status === 'trialing' && trialEndsAt) {
    const trialMs = Date.parse(trialEndsAt)
    if (Number.isFinite(trialMs) && trialMs > nowMs) return false
  }

  // implicit-trial: created_at + 14д ещё не прошёл → ещё в доступе.
  if (!Number.isFinite(createdAtMs)) return false
  return createdAtMs < nowMs - DEMO_TRIAL_DAYS * DAY_MS
}
