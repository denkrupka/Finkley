/**
 * Чистая логика gamified «Настройки Finkley» (T2 / v2).
 *
 * Прогресс/проценты/«осталось N шагов»/право на награду считаются здесь,
 * чтобы покрыть unit-тестами и держать UI тупым. Серверный авторитет —
 * RPC setup_progress + edge function claim-setup-reward; этот модуль лишь
 * переводит серверные булевы + клиентские «пропуски» в модель для UI.
 *
 * Поведенческие рычаги (Nunes–Drèze endowed progress, goal-gradient,
 * Zeigarnik): бар стартует НЕ с 0%, а с ENDOWED_PERCENT (салон уже создан),
 * и считает «осталось N шагов», а не «X из N».
 *
 * v2 (онбординг сокращён): чек-лист доводит салон до полного заполнения.
 * Шаги делятся на:
 *   - CORE (required) — визит/расход/booksy/банк/дашборд. Гейтят только НАГРАДУ
 *     «+14 дней» (isCoreComplete + окно 7 дней).
 *   - EXTRA (optional) — конкуренты/склад/маркетинг/мессенджеры/AI/интеграции/
 *     соц-страницы/Google/финотчёт/банк-линковка и т.д. Уже-подключённые на
 *     онбординге интеграции приезжают как done с сервера.
 *
 * v3 (редизайн Stripe-style, фикс «100%»): процент и видимость считаются по
 * ВСЕМ незадизмиссенным шагам (core + extra). 100% ⟺ все шаги done или
 * dismissed. Бар висит пока не все задания сделаны/пропущены; путь его закрыть —
 * выполнить или пропустить каждое задание. Награда осталась за CORE.
 */

export const DAY_MS = 24 * 60 * 60 * 1000
/** Эффект endowed progress: салон создан → стартуем с 40%, не с нуля. */
export const ENDOWED_PERCENT = 40
/** Окно для приза «+14 дней» — 7 дней с момента создания салона. */
export const REWARD_WINDOW_DAYS = 7
/**
 * Дальний backstop: дольше этого срока бар не показываем — это onboarding-нудж,
 * а не вечная плашка. НЕ скрывает бар при core-готовности (см. shouldShowSetupBar).
 */
export const MAX_VISIBLE_AGE_DAYS = 90
export const REWARD_BONUS_DAYS = 14

export type SetupProgressData = {
  // ── core (back-compat) ──
  salon_created: boolean
  has_visit: boolean
  has_expense: boolean
  booksy_connected: boolean
  bank_connected: boolean
  dashboard_opened: boolean
  created_at: string
  reward_granted_at: string | null
  // ── v2 трекинг полноты ──
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

/** Безопасные дефолты для v2-полей (старый сервер / отсутствующие ключи → false). */
export const SETUP_PROGRESS_DEFAULTS: Pick<
  SetupProgressData,
  | 'has_first_client_closed'
  | 'has_expense_calculated'
  | 'has_scheduled_payment'
  | 'bank_synced'
  | 'has_bank_tx_linked'
  | 'has_finance_report'
  | 'has_competitor'
  | 'has_social_page'
  | 'has_google_profile'
  | 'has_inventory_item'
  | 'has_marketing_broadcast'
  | 'has_messenger_message'
  | 'ai_assistant_seen'
  | 'booking_connected'
  | 'any_integration'
> = {
  has_first_client_closed: false,
  has_expense_calculated: false,
  has_scheduled_payment: false,
  bank_synced: false,
  has_bank_tx_linked: false,
  has_finance_report: false,
  has_competitor: false,
  has_social_page: false,
  has_google_profile: false,
  has_inventory_item: false,
  has_marketing_broadcast: false,
  has_messenger_message: false,
  ai_assistant_seen: false,
  booking_connected: false,
  any_integration: false,
}

export type SetupStepId =
  // core
  | 'visit'
  | 'expense'
  | 'booksy'
  | 'bank'
  | 'dashboard'
  // extra (v2)
  | 'first_client_closed'
  | 'expense_calculated'
  | 'scheduled_payment'
  | 'bank_synced'
  | 'bank_tx_linked'
  | 'finance_report'
  | 'competitor'
  | 'social_page'
  | 'google_profile'
  | 'inventory_item'
  | 'marketing_broadcast'
  | 'messenger_message'
  | 'ai_assistant'
  | 'booking'
  | 'any_integration'

/** Логическая группа карточки в чек-листе (для подзаголовков/группировки в UI). */
export type SetupStepGroup =
  | 'income'
  | 'expenses'
  | 'finance'
  | 'banking'
  | 'growth'
  | 'integrations'

/** Порядок категорий в раскрытом чек-листе (Stripe-style accordion). */
export const SETUP_GROUP_ORDER: readonly SetupStepGroup[] = [
  'income',
  'expenses',
  'finance',
  'banking',
  'growth',
  'integrations',
] as const

export type SetupStep = {
  id: SetupStepId
  group: SetupStepGroup
  /** Core-шаг — влияет на процент/награду. Extra — только полнота чек-листа. */
  required: boolean
  /** Засчитан: либо реально выполнен на сервере, либо пропущен юзером (для dismissable). */
  done: boolean
  /** Реально выполнен по серверным данным (для иконки «галка» vs «пропущено»). */
  serverDone: boolean
  /** Можно пропустить (салон может не пользоваться этим разделом). */
  dismissable: boolean
  /** Пропущен юзером (клиентский localStorage-флаг). */
  dismissed: boolean
}

type StepDef = {
  id: SetupStepId
  group: SetupStepGroup
  required: boolean
  dismissable: boolean
  /** Картирование на серверное булево. */
  serverKey: (data: SetupProgressData) => boolean
}

/**
 * Источник правды по шагам. Порядок = порядок карточек в чек-листе.
 * Core-шаги первыми (визит/расход/booksy/банк/дашборд — как раньше),
 * далее extra-шаги полноты, сгруппированные по смыслу.
 */
const STEP_DEFS: readonly StepDef[] = [
  // ── CORE (required, гейтят процент + награду) ──
  {
    id: 'visit',
    group: 'income',
    required: true,
    dismissable: false,
    serverKey: (d) => d.has_visit,
  },
  {
    id: 'expense',
    group: 'expenses',
    required: true,
    dismissable: false,
    serverKey: (d) => d.has_expense,
  },
  {
    id: 'booksy',
    group: 'integrations',
    required: true,
    dismissable: true,
    serverKey: (d) => d.booksy_connected,
  },
  {
    id: 'bank',
    group: 'banking',
    required: true,
    dismissable: true,
    serverKey: (d) => d.bank_connected,
  },
  {
    id: 'dashboard',
    group: 'finance',
    required: true,
    dismissable: false,
    serverKey: (d) => d.dashboard_opened,
  },

  // ── EXTRA: доходы ──
  {
    id: 'first_client_closed',
    group: 'income',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_first_client_closed,
  },

  // ── EXTRA: расходы ──
  {
    id: 'expense_calculated',
    group: 'expenses',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_expense_calculated,
  },
  {
    id: 'scheduled_payment',
    group: 'expenses',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_scheduled_payment,
  },

  // ── EXTRA: банк ──
  {
    id: 'bank_synced',
    group: 'banking',
    required: false,
    dismissable: true,
    serverKey: (d) => d.bank_synced,
  },
  {
    id: 'bank_tx_linked',
    group: 'banking',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_bank_tx_linked,
  },

  // ── EXTRA: финансы ──
  {
    id: 'finance_report',
    group: 'finance',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_finance_report,
  },

  // ── EXTRA: рост / маркетинг ──
  {
    id: 'competitor',
    group: 'growth',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_competitor,
  },
  {
    id: 'social_page',
    group: 'growth',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_social_page,
  },
  {
    id: 'google_profile',
    group: 'growth',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_google_profile,
  },
  {
    id: 'marketing_broadcast',
    group: 'growth',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_marketing_broadcast,
  },

  // ── EXTRA: склад / мессенджеры / AI ──
  {
    id: 'inventory_item',
    group: 'expenses',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_inventory_item,
  },
  {
    id: 'messenger_message',
    group: 'integrations',
    required: false,
    dismissable: true,
    serverKey: (d) => d.has_messenger_message,
  },
  {
    id: 'ai_assistant',
    group: 'finance',
    required: false,
    dismissable: true,
    serverKey: (d) => d.ai_assistant_seen,
  },

  // ── EXTRA: интеграции ──
  {
    id: 'booking',
    group: 'integrations',
    required: false,
    dismissable: true,
    serverKey: (d) => d.booking_connected,
  },
  {
    id: 'any_integration',
    group: 'integrations',
    required: false,
    dismissable: true,
    serverKey: (d) => d.any_integration,
  },
]

const STEP_DEF_BY_ID = new Map<SetupStepId, StepDef>(STEP_DEFS.map((d) => [d.id, d]))

/** Порядок карточек в чек-листе (весь набор). */
export const SETUP_STEP_ORDER: SetupStepId[] = STEP_DEFS.map((d) => d.id)

/** Только core-шаги — они гейтят процент/награду (back-compat со старой моделью). */
export const SETUP_REQUIRED_STEPS: SetupStepId[] = STEP_DEFS.filter((d) => d.required).map(
  (d) => d.id,
)

function serverDoneFor(data: SetupProgressData, id: SetupStepId): boolean {
  return STEP_DEF_BY_ID.get(id)?.serverKey(data) ?? false
}

export function computeSetupSteps(
  data: SetupProgressData,
  dismissed: ReadonlySet<SetupStepId>,
): SetupStep[] {
  return STEP_DEFS.map((def) => {
    const serverDone = serverDoneFor(data, def.id)
    const isDismissed = def.dismissable && dismissed.has(def.id)
    return {
      id: def.id,
      group: def.group,
      required: def.required,
      serverDone,
      dismissable: def.dismissable,
      dismissed: isDismissed,
      done: serverDone || isDismissed,
    }
  })
}

/** Только core-шаги (визит/расход/booksy/банк/дашборд). */
function requiredSteps(steps: SetupStep[]): SetupStep[] {
  return steps.filter((s) => s.required)
}

/** Незадизмиссенные шаги — те, что реально участвуют в проценте/счётчике. */
function nonDismissedSteps(steps: SetupStep[]): SetupStep[] {
  return steps.filter((s) => !s.dismissed)
}

/**
 * Процент готовности по ВСЕМ незадизмиссенным шагам (core + extra):
 * 40% endowed (салон создан) + 60% поровну по оставшимся незадизмиссенным
 * заданиям. Дизмиссенный шаг исключён из знаменателя (юзер от него отказался).
 *
 * 100% ⟺ все незадизмиссенные шаги выполнены (serverDone). Если незадизмиссенных
 * шагов не осталось (всё done/dismissed) → 100%.
 */
export function computePercent(steps: SetupStep[]): number {
  const active = nonDismissedSteps(steps)
  if (active.length === 0) return 100
  const doneCount = active.filter((s) => s.done).length
  return Math.round(ENDOWED_PERCENT + (100 - ENDOWED_PERCENT) * (doneCount / active.length))
}

/** Goal-gradient: сколько незадизмиссенных заданий (core+extra) ещё осталось. */
export function remainingSteps(steps: SetupStep[]): number {
  return nonDismissedSteps(steps).filter((s) => !s.done).length
}

/** Все ли CORE-шаги выполнены (визит/расход/booksy/банк/дашборд). Гейтит награду. */
export function isCoreComplete(steps: SetupStep[]): boolean {
  return requiredSteps(steps).every((s) => s.done)
}

/** Все ли задания (core + extra) выполнены или пропущены. Гейтит видимость бара. */
export function isAllComplete(steps: SetupStep[]): boolean {
  return steps.every((s) => s.done)
}

/** Сколько extra-задач полноты ещё не выполнено и не пропущено (для подсказки в UI). */
export function remainingExtraSteps(steps: SetupStep[]): number {
  return steps.filter((s) => !s.required && !s.done).length
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
 * Активно ли окно бонуса €20: приз ещё не выдан и 7-дневное окно открыто.
 * Не зависит от выполненности заданий — UI показывает «бонус €20» как обещание,
 * пока окно открыто; после окна бонус больше не упоминаем (owner 2026-06-30).
 */
export function isBonusWindowActive(data: SetupProgressData, now: number = Date.now()): boolean {
  if (data.reward_granted_at) return false
  return withinRewardWindow(data.created_at, now)
}

/**
 * Право забрать приз €20 (клиентский гейт; реальный авторитет — сервер).
 * Награда — за ВСЕ задания настройки (owner 2026-06-30): приз не выдан + ВСЕ
 * шаги выполнены (isAllComplete) + окно 7 дней ещё открыто. isAllComplete уже
 * включает визит+расход, поэтому отдельная проверка не нужна.
 */
export function isRewardEligible(
  data: SetupProgressData,
  steps: SetupStep[],
  now: number = Date.now(),
): boolean {
  if (data.reward_granted_at) return false
  if (!isAllComplete(steps)) return false
  return withinRewardWindow(data.created_at, now)
}

/**
 * Показывать ли бар. Только owner; держим на экране пока НЕ все задания сделаны
 * ИЛИ пока есть неполученная награда €20 (всё сделано в окне 7 дней, но приз ещё
 * не забран — оставляем бар, чтобы дать его забрать). Полностью готовый салон
 * скрывает бар только после выдачи приза или закрытия окна бонуса.
 *
 * MAX_VISIBLE_AGE_DAYS — дальний backstop (90 дней), чтобы плашка не висела вечно.
 */
export function shouldShowSetupBar(
  data: SetupProgressData,
  steps: SetupStep[],
  role: string | undefined,
  now: number = Date.now(),
): boolean {
  if (role !== 'owner') return false
  const ageDays = (now - new Date(data.created_at).getTime()) / DAY_MS
  if (ageDays > MAX_VISIBLE_AGE_DAYS) return false
  return !isAllComplete(steps) || isRewardEligible(data, steps, now)
}

/** Категория для аккордеона: её шаги + счётчик «k/n» (k = done, n = всего). */
export type SetupGroupView = {
  group: SetupStepGroup
  steps: SetupStep[]
  doneCount: number
  total: number
  /** Все шаги категории done/dismissed. */
  complete: boolean
}

/**
 * Группирует шаги по категориям в порядке SETUP_GROUP_ORDER (для UI-аккордеона).
 * Пустые категории не возвращаются.
 */
export function groupSetupSteps(steps: SetupStep[]): SetupGroupView[] {
  return SETUP_GROUP_ORDER.map((group) => {
    const groupSteps = steps.filter((s) => s.group === group)
    const doneCount = groupSteps.filter((s) => s.done).length
    return {
      group,
      steps: groupSteps,
      doneCount,
      total: groupSteps.length,
      complete: groupSteps.length > 0 && doneCount === groupSteps.length,
    }
  }).filter((g) => g.total > 0)
}
