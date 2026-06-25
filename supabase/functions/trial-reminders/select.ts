/**
 * Pure recipient-selection + bucket logic for trial-reminders.
 *
 * НЕТ импортов Deno/Supabase — модуль юнит-тестируется в vitest
 * (см. select.test.ts). Вся арифметика дат — в UTC.
 *
 * Контекст: implicit-trial салоны (демо 14 дней без карты) НЕ имеют строки в
 * salon_subscriptions — их дедлайн = salons.created_at + 14 дней (зеркалит
 * apps/web/src/lib/entitlements.ts DEMO_TRIAL_DAYS и
 * supabase/functions/claim-setup-reward IMPLICIT_TRIAL_DAYS). Если строка sub
 * есть (чекаут/награда/админ-грант) — учитываем trial_ends_at и bonus_until.
 */

/** Должно совпадать с DEMO_TRIAL_DAYS (entitlements.ts) и IMPLICIT_TRIAL_DAYS (claim-setup-reward). */
export const IMPLICIT_TRIAL_DAYS = 14
const DAY_MS = 86_400_000

export type TrialSub =
  | {
      status?: string | null
      trial_ends_at?: string | null
      bonus_until?: string | null
    }
  | null
  | undefined

export type TrialKind = 'trial_3d' | 'trial_1d' | 'trial_expired'

/**
 * Эффективный дедлайн доступа в ms:
 * max(created_at + 14д, sub.trial_ends_at, sub.bonus_until).
 * Возвращает 0, если дату посчитать нельзя.
 */
export function effectiveTrialEndMs(sub: TrialSub, salonCreatedAtIso: string): number {
  const createdMs = Date.parse(salonCreatedAtIso)
  const candidates = [
    Number.isFinite(createdMs) ? createdMs + IMPLICIT_TRIAL_DAYS * DAY_MS : 0,
    sub?.trial_ends_at ? Date.parse(sub.trial_ends_at) : 0,
    sub?.bonus_until ? Date.parse(sub.bonus_until) : 0,
  ].filter((n) => Number.isFinite(n) && n > 0)
  return candidates.length ? Math.max(...candidates) : 0
}

function utcMidnight(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Целочисленная разница в UTC-днях между дедлайном и now → bucket.
 * 3 → trial_3d, 1 → trial_1d, 0 → trial_expired, иначе null.
 * Cron гоняется раз в день, поэтому салон попадёт в каждый bucket ровно раз.
 */
export function classifyTrialBucket(effectiveEndMs: number, nowMs: number): TrialKind | null {
  if (!Number.isFinite(effectiveEndMs) || effectiveEndMs <= 0) return null
  const daysLeft = Math.round((utcMidnight(effectiveEndMs) - utcMidnight(nowMs)) / DAY_MS)
  if (daysLeft === 3) return 'trial_3d'
  if (daysLeft === 1) return 'trial_1d'
  if (daysLeft === 0) return 'trial_expired'
  return null
}

/**
 * Салон с активной/просроченной платной подпиской НЕ на триале → не слать
 * trial-напоминания (иначе платящий клиент получит «триал заканчивается»).
 */
export function isPaidSubscription(sub: TrialSub): boolean {
  const s = sub?.status
  return s === 'active' || s === 'past_due'
}

/** notification_prefs[key] !== false (отсутствие ключа = включено). */
export function isTypeEnabled(
  prefs: Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  if (!prefs) return true
  return prefs[key] !== false
}

/** Дата дедлайна YYYY-MM-DD (UTC) — часть ключа дедупликации. */
export function deadlineDateUtc(effectiveEndMs: number): string {
  return new Date(utcMidnight(effectiveEndMs)).toISOString().slice(0, 10)
}

/** Маппинг bucket → alias email-шаблона. */
export function templateForKind(kind: TrialKind): 'trial_ending' | 'trial_expired' {
  return kind === 'trial_expired' ? 'trial_expired' : 'trial_ending'
}

/** days_left для шаблона trial_ending (для trial_expired не используется). */
export function daysLeftForKind(kind: TrialKind): number {
  if (kind === 'trial_3d') return 3
  if (kind === 'trial_1d') return 1
  return 0
}
