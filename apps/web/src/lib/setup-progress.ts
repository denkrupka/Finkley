/**
 * Чистая логика gamified «Настройки Finkley» (T2).
 *
 * Прогресс/проценты/«осталось N шагов»/право на награду считаются здесь,
 * чтобы покрыть unit-тестами и держать UI тупым. Серверный авторитет —
 * RPC setup_progress + edge function claim-setup-reward; этот модуль лишь
 * переводит серверные булевы + клиентские «пропуски» в модель для UI.
 *
 * Поведенческие рычаги (Nunes–Drèze endowed progress, goal-gradient,
 * Zeigarnik): бар стартует НЕ с 0%, а с ENDOWED_PERCENT (салон уже создан),
 * и считает «осталось N шагов», а не «X из N».
 */

export const DAY_MS = 24 * 60 * 60 * 1000
/** Эффект endowed progress: салон создан → стартуем с 40%, не с нуля. */
export const ENDOWED_PERCENT = 40
/** Окно для приза «+14 дней» — 7 дней с момента создания салона. */
export const REWARD_WINDOW_DAYS = 7
/** Дольше этого срока бар не показываем — это onboarding-нудж, не вечная плашка. */
export const MAX_VISIBLE_AGE_DAYS = 30
export const REWARD_BONUS_DAYS = 14

export type SetupProgressData = {
  salon_created: boolean
  has_visit: boolean
  has_expense: boolean
  booksy_connected: boolean
  bank_connected: boolean
  dashboard_opened: boolean
  created_at: string
  reward_granted_at: string | null
}

export type SetupStepId = 'visit' | 'expense' | 'booksy' | 'bank' | 'dashboard'

export type SetupStep = {
  id: SetupStepId
  /** Засчитан: либо реально выполнен на сервере, либо пропущен юзером (для dismissable). */
  done: boolean
  /** Реально выполнен по серверным данным (для иконки «галка» vs «пропущено»). */
  serverDone: boolean
  /** Можно пропустить (Booksy/банк — салон может ими не пользоваться). */
  dismissable: boolean
  /** Пропущен юзером (клиентский localStorage-флаг). */
  dismissed: boolean
}

/** Порядок карточек в чек-листе. */
export const SETUP_STEP_ORDER: SetupStepId[] = ['visit', 'expense', 'booksy', 'bank', 'dashboard']

const DISMISSABLE: ReadonlySet<SetupStepId> = new Set<SetupStepId>(['booksy', 'bank'])

function serverDoneFor(data: SetupProgressData, id: SetupStepId): boolean {
  switch (id) {
    case 'visit':
      return data.has_visit
    case 'expense':
      return data.has_expense
    case 'booksy':
      return data.booksy_connected
    case 'bank':
      return data.bank_connected
    case 'dashboard':
      return data.dashboard_opened
  }
}

export function computeSetupSteps(
  data: SetupProgressData,
  dismissed: ReadonlySet<SetupStepId>,
): SetupStep[] {
  return SETUP_STEP_ORDER.map((id) => {
    const serverDone = serverDoneFor(data, id)
    const dismissable = DISMISSABLE.has(id)
    const isDismissed = dismissable && dismissed.has(id)
    return {
      id,
      serverDone,
      dismissable,
      dismissed: isDismissed,
      done: serverDone || isDismissed,
    }
  })
}

/** Процент готовности: 40% endowed (салон создан) + 60% поровну по шагам. */
export function computePercent(steps: SetupStep[]): number {
  if (steps.length === 0) return 100
  const doneCount = steps.filter((s) => s.done).length
  return Math.round(ENDOWED_PERCENT + (100 - ENDOWED_PERCENT) * (doneCount / steps.length))
}

/** Goal-gradient: сколько шагов ещё осталось (не «X из N»). */
export function remainingSteps(steps: SetupStep[]): number {
  return steps.filter((s) => !s.done).length
}

export function isAllComplete(steps: SetupStep[]): boolean {
  return steps.every((s) => s.done)
}

/** Сколько дней осталось до закрытия окна приза (>=0, может быть 0). */
export function rewardDaysLeft(createdAt: string, now: number = Date.now()): number {
  const deadline = new Date(createdAt).getTime() + REWARD_WINDOW_DAYS * DAY_MS
  return Math.max(0, Math.ceil((deadline - now) / DAY_MS))
}

export function withinRewardWindow(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() <= REWARD_WINDOW_DAYS * DAY_MS
}

/**
 * Право забрать приз (клиентский гейт; реальный авторитет — сервер).
 * Все шаги выполнены + есть реальные данные (визит И расход) + окно 7 дней
 * ещё открыто + приз не выдан.
 */
export function isRewardEligible(
  data: SetupProgressData,
  steps: SetupStep[],
  now: number = Date.now(),
): boolean {
  if (data.reward_granted_at) return false
  if (!data.has_visit || !data.has_expense) return false
  if (!isAllComplete(steps)) return false
  return withinRewardWindow(data.created_at, now)
}

/**
 * Показывать ли бар. Только owner; не назойливо для старых салонов (>30 дней);
 * скрываем когда всё сделано и приз уже неактуален/выдан.
 */
export function shouldShowSetupBar(
  data: SetupProgressData,
  steps: SetupStep[],
  role: string | undefined,
  now: number = Date.now(),
): boolean {
  if (role !== 'owner') return false
  if (data.reward_granted_at) return false
  const ageDays = (now - new Date(data.created_at).getTime()) / DAY_MS
  if (ageDays > MAX_VISIBLE_AGE_DAYS) return false
  const allComplete = isAllComplete(steps)
  if (allComplete && !isRewardEligible(data, steps, now)) return false
  return true
}
