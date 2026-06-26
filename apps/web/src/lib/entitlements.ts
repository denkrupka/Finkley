/**
 * Тарифные планы и энтайтлменты по секциям (T7).
 *
 * Чистая логика (без React/Supabase) — покрыта unit-тестами, зеркалит
 * паттерн permissions-logic.ts. UI-гейтинг (overlay) строится поверх неё
 * (useEntitlements + RequireEntitlement). Серверной enforcement'а нет —
 * это UI-altitude гейт, как и RBAC (RLS — реальный бэкстоп данных).
 *
 * Модель тарифов (владелец, 2026-06-18):
 *   demo  — весь функционал, 14 дней (триал)
 *   free  — только Доходы (+ dashboard/настройки); остальное → upgrade-плашка
 *   €19   — Доходы + Расходы + Отчёты + Мессенджер
 *   €49   — всё из €19 + Маркетинг + AI
 *   €69   — всё (вкл. Финансы + Склад)
 *   €99   — всё + несколько салонов
 */

export type Plan = 'demo' | 'free' | 't19' | 't49' | 't69' | 't99'

/** Гейтируемые секции = NavItemId (см. nav-config.ts). */
export type SectionId =
  | 'dashboard'
  | 'income'
  | 'expenses'
  | 'reports'
  | 'finance'
  | 'inventory'
  | 'marketing'
  | 'messenger'
  | 'ai'
  | 'settings'

/** Ранг плана для сравнения «план >= минимально нужного». demo = полный доступ. */
export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  t19: 1,
  t49: 2,
  t69: 3,
  t99: 4,
  demo: 5,
}

/** Цена плана в евро (для CTA «Перейти на €N»). */
export const PLAN_PRICE_EUR: Record<Plan, number> = {
  demo: 0,
  free: 0,
  t19: 19,
  t49: 49,
  t69: 69,
  t99: 99,
}

/**
 * i18n-ключ человекочитаемого имени плана — единый источник правды для
 * бейджа в шапке и биллинг-секции (Demo / Бесплатный / Старт / Рост /
 * Полный / Сеть). Не хардкодь строки в JSX — резолвь через `t(PLAN_NAME_KEY[plan])`.
 */
export const PLAN_NAME_KEY: Record<Plan, string> = {
  demo: 'plan.names.demo',
  free: 'plan.names.free',
  t19: 'plan.names.t19',
  t49: 'plan.names.t49',
  t69: 'plan.names.t69',
  t99: 'plan.names.t99',
}

/** Платные планы в порядке возрастания — для пикера тарифов. */
export const PAID_PLANS: Plan[] = ['t19', 't49', 't69', 't99']

/** Минимальный план, открывающий секцию. */
export const SECTION_MIN_PLAN: Record<SectionId, Plan> = {
  dashboard: 'free',
  income: 'free',
  settings: 'free',
  expenses: 't19',
  reports: 't19',
  messenger: 't19',
  marketing: 't49',
  ai: 't49',
  finance: 't69',
  inventory: 't69',
}

/**
 * Грандфазеринг: салоны, созданные ДО запуска тарифной модели, не теряют
 * доступ при включении гейтинга — считаем их demo (полный доступ). Новые
 * салоны идут по воронке demo(14д) → free → платный.
 */
export const GRANDFATHER_BEFORE = '2026-06-18T00:00:00Z'
export const DEMO_TRIAL_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

export type SubscriptionLike = {
  status: string
  plan?: string | null
  trial_ends_at?: string | null
  bonus_until?: string | null
} | null

function asPlan(v: string | null | undefined): Plan {
  return v && v in PLAN_RANK ? (v as Plan) : 'demo'
}

/**
 * Эффективный план салона из подписки + даты создания.
 *
 * Приоритет: бонус/админ-грант или активный триал → demo (полный доступ);
 * активная платная подписка → её план; иначе для салона без подписки —
 * implicit demo на 14 дней (или grandfather), затем free; для салона с
 * истёкшим триалом/отменой → free.
 */
export function effectivePlan(
  sub: SubscriptionLike,
  salonCreatedAt: string | undefined,
  now: number = Date.now(),
): Plan {
  if (sub) {
    if (sub.bonus_until && new Date(sub.bonus_until).getTime() > now) return 'demo'
    if (sub.status === 'active' || sub.status === 'past_due') return asPlan(sub.plan)
    if (
      sub.status === 'trialing' &&
      sub.trial_ends_at &&
      new Date(sub.trial_ends_at).getTime() > now
    ) {
      return 'demo'
    }
    // trial истёк / canceled / unpaid / incomplete → free
    return 'free'
  }
  // Нет подписки.
  if (salonCreatedAt) {
    const createdMs = new Date(salonCreatedAt).getTime()
    if (createdMs < new Date(GRANDFATHER_BEFORE).getTime()) return 'demo'
    if (now - createdMs < DEMO_TRIAL_DAYS * DAY_MS) return 'demo'
  }
  return 'free'
}

/** Доступна ли секция на этом плане. */
export function canAccessSection(plan: Plan, section: SectionId): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[SECTION_MIN_PLAN[section]]
}

/** Минимальный план, который нужно купить чтобы открыть секцию (для CTA). */
export function upgradeTargetForSection(section: SectionId): Plan {
  return SECTION_MIN_PLAN[section]
}

/** Можно ли создавать несколько салонов (мультисалон — только €99). */
export function canCreateMultipleSalons(plan: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK.t99
}
