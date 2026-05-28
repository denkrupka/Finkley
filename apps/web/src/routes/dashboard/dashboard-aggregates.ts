/**
 * Pure-aggregates для DashboardPage. Вынесено в отдельный файл, чтобы
 * сам компонент остался декларативным (одна линия — один проп), а вся
 * математика была тестируема юнитами.
 *
 * Все функции stateless и принимают плоские данные из хуков
 * (clients/visits/staff/services/inventory), возвращают агрегаты.
 */

import type { ClientRow } from '@/hooks/useClients'
import type { ServiceCategoryRow, ServiceRow } from '@/hooks/useServices'
import type { StaffRow } from '@/hooks/useStaff'
import type { VisitRow } from '@/hooks/useVisits'
import { effectiveReceivedFromVisit } from '@/lib/income/effective-received'

// ─── Финансы: выручка по категориям услуг ─────────────────────────────────

/**
 * Группирует визиты по services.category_id → category.name → revenue%.
 * Используется в FinancesSection.revenueByCategory.
 *
 * - Берём только paid визиты (выручка факт).
 * - Услуги без category → «Прочее».
 * - Возвращает top 5 категорий по доле, нормализованной к 100%.
 */
export function computeRevenueByCategory(
  visits: Array<
    Pick<
      VisitRow,
      | 'service_id'
      | 'status'
      | 'amount_cents'
      | 'discount_cents'
      | 'tip_cents'
      | 'paid_amount_cents'
      | 'kind'
    >
  >,
  services: Array<Pick<ServiceRow, 'id' | 'category_id'>>,
  categories: Array<Pick<ServiceCategoryRow, 'id' | 'name'>>,
): Array<{ name: string; pct: number }> {
  const serviceCatId = new Map(services.map((s) => [s.id, s.category_id]))
  const catName = new Map(categories.map((c) => [c.id, c.name]))

  const bucket = new Map<string, number>()
  let total = 0
  for (const v of visits) {
    if (v.status !== 'paid') continue
    const cents = effectiveReceivedFromVisit(v)
    if (cents <= 0) continue
    let label = 'Прочее'
    if (v.kind === 'retail') label = 'Продажа материалов'
    else if (v.service_id) {
      // У услуги может не быть category_id — это валидно, всё равно
      // показываем «Без категории» а не сваливаем в общую корзину
      // «Прочее» (где визиты без service_id вообще).
      const catId = serviceCatId.get(v.service_id)
      label = catId ? (catName.get(catId) ?? 'Без категории') : 'Без категории'
    }
    bucket.set(label, (bucket.get(label) ?? 0) + cents)
    total += cents
  }
  if (total === 0) return []
  return Array.from(bucket.entries())
    .map(([name, cents]) => ({ name, pct: (cents / total) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)
}

// ─── Клиенты: новые / постоянные / RFM ────────────────────────────────────

/** Новые клиенты в периоде (по created_at). */
export function computeNewClientsCount(
  clients: Array<Pick<ClientRow, 'created_at'>>,
  range: { start: string; end: string },
): number {
  return clients.filter((c) => c.created_at >= range.start && c.created_at < range.end).length
}

/**
 * Постоянные клиенты — те, у кого ≥3 визитов всего (clients.visit_count).
 * Не путать с retention — это just активное ядро базы.
 */
export function computeRegularClientsCount(clients: Array<Pick<ClientRow, 'visit_count'>>): number {
  return clients.filter((c) => (c.visit_count ?? 0) >= 3).length
}

/**
 * RFM-сегментация на лету. 6 корзин:
 *   - Чемпионы:     визит ≤30 дн, ≥5 визитов
 *   - Лояльные:     визит ≤90 дн, ≥3 визитов
 *   - Перспективные: новые (created ≤30 дн) с 1-2 визитами
 *   - Под риском:    visit 30-90 дн, ≥3 визитов
 *   - Спящие:        visit 90-180 дн
 *   - Потерянные:    visit >180 дн или null
 */
export type RfmSegment = {
  key: 'champions' | 'loyal' | 'potential' | 'risk' | 'sleep' | 'lost'
  name: string
  count: number
  description: string
  fill: string
  text: string
}

export function computeRfm(
  clients: Array<Pick<ClientRow, 'visit_count' | 'last_visit_at' | 'created_at'>>,
  now: Date = new Date(),
): RfmSegment[] {
  const day = 24 * 3600 * 1000
  const ts = now.getTime()
  const counts = { champions: 0, loyal: 0, potential: 0, risk: 0, sleep: 0, lost: 0 }
  for (const c of clients) {
    const visits = c.visit_count ?? 0
    const lastVisitMs = c.last_visit_at ? new Date(c.last_visit_at).getTime() : 0
    const createdMs = c.created_at ? new Date(c.created_at).getTime() : 0
    const daysSinceLast = lastVisitMs > 0 ? (ts - lastVisitMs) / day : Infinity
    const daysSinceCreate = createdMs > 0 ? (ts - createdMs) / day : Infinity

    // T92 — Perspective опираемся на last_visit, не created_at. При импорте
    // всех клиентов разом created_at = NOW → 922 «перспективных» из 1000.
    // По last_visit ≤30 дней мы реально видим тех, кто пришёл недавно
    // первый-второй раз и его ещё можно дотянуть в лояльных.
    if (visits >= 5 && daysSinceLast <= 30) counts.champions++
    else if (visits >= 3 && daysSinceLast <= 60) counts.loyal++
    else if (visits >= 1 && visits <= 2 && daysSinceLast <= 30) counts.potential++
    else if (visits >= 3 && daysSinceLast > 60 && daysSinceLast <= 90) counts.risk++
    else if (daysSinceLast > 90 && daysSinceLast <= 180) counts.sleep++
    else counts.lost++
    void daysSinceCreate
  }
  return [
    {
      key: 'champions',
      name: 'Чемпионы',
      count: counts.champions,
      description: 'часто, недавно, много',
      fill: 'rgb(220 252 231)',
      text: 'rgb(21 128 61)',
    },
    {
      key: 'loyal',
      name: 'Лояльные',
      count: counts.loyal,
      description: 'регулярно ходят',
      fill: 'rgb(243 232 255)',
      text: 'rgb(126 34 206)',
    },
    {
      key: 'potential',
      name: 'Перспективные',
      count: counts.potential,
      description: 'новые, вернулись',
      fill: 'rgb(219 234 254)',
      text: 'rgb(30 64 175)',
    },
    {
      key: 'risk',
      name: 'Под риском',
      count: counts.risk,
      description: 'давно не приходили',
      fill: 'rgb(254 243 199)',
      text: 'rgb(146 64 14)',
    },
    {
      key: 'sleep',
      name: 'Спящие',
      count: counts.sleep,
      description: '3+ мес. отсутствия',
      fill: 'rgb(254 226 226)',
      text: 'rgb(153 27 27)',
    },
    {
      key: 'lost',
      name: 'Потерянные',
      count: counts.lost,
      description: '6+ мес., 1 визит',
      fill: 'rgb(243 244 246)',
      text: 'rgb(75 85 99)',
    },
  ]
}

/** Активные клиенты (визит ≤90 дн). */
export function computeActiveClients(
  clients: Array<Pick<ClientRow, 'last_visit_at'>>,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - 90 * 24 * 3600 * 1000
  return clients.filter((c) => c.last_visit_at && new Date(c.last_visit_at).getTime() >= cutoff)
    .length
}

/** Нужна реактивация (90-180 дней с последнего визита). */
export function computeNeedsReactivation(
  clients: Array<Pick<ClientRow, 'last_visit_at'>>,
  now: Date = new Date(),
): number {
  const ts = now.getTime()
  const day = 24 * 3600 * 1000
  return clients.filter((c) => {
    if (!c.last_visit_at) return false
    const diff = (ts - new Date(c.last_visit_at).getTime()) / day
    return diff > 90 && diff <= 180
  }).length
}

// ─── Retention / churn ────────────────────────────────────────────────────

/**
 * Retention % = (клиенты пришедшие и в текущем, и в предыдущем периоде) /
 *                (клиенты пришедшие в предыдущем периоде) × 100.
 *
 * Возвращает null если в прошлом периоде не было визитов (нечего сравнивать).
 */
export function computeRetentionPct(
  currentVisits: Array<Pick<VisitRow, 'client_id' | 'status'>>,
  previousVisits: Array<Pick<VisitRow, 'client_id' | 'status'>>,
): { retentionPct: number | null; returningCount: number; churnedCount: number } {
  const current = new Set(
    currentVisits.filter((v) => v.status === 'paid' && v.client_id).map((v) => v.client_id!),
  )
  const previous = new Set(
    previousVisits.filter((v) => v.status === 'paid' && v.client_id).map((v) => v.client_id!),
  )
  if (previous.size === 0) return { retentionPct: null, returningCount: 0, churnedCount: 0 }
  let returning = 0
  for (const id of current) if (previous.has(id)) returning++
  const churned = previous.size - returning
  return {
    retentionPct: (returning / previous.size) * 100,
    returningCount: returning,
    churnedCount: churned,
  }
}

// ─── Заполненность (occupancy) ────────────────────────────────────────────

/**
 * Заполненность % = используемые часы / доступные часы × 100.
 *
 * Доступные часы = active_staff × 8 ч × 22 рабочих дня в месяце.
 * Используемые = sum(visit.duration_min || 60 мин) / 60 для paid визитов.
 *
 * Это аппроксимация (мы не знаем реальный график мастеров). Достаточно,
 * чтобы видеть «низко / норма / высоко» и MoM-динамику.
 */
export function computeOccupancyPct(
  visits: Array<Pick<VisitRow, 'duration_min' | 'status' | 'kind'>>,
  activeStaffCount: number,
  workingDaysInPeriod = 22,
): number | null {
  if (activeStaffCount <= 0) return null
  const usedHours = visits
    .filter((v) => v.status === 'paid' && v.kind !== 'retail')
    .reduce((acc, v) => acc + (v.duration_min ?? 60) / 60, 0)
  const availableHours = activeStaffCount * 8 * workingDaysInPeriod
  if (availableHours <= 0) return null
  return Math.min(100, (usedHours / availableHours) * 100)
}

// ─── Маркетинг: источники клиентов ────────────────────────────────────────

const SOURCE_COLORS = [
  'rgb(219 39 119)', // pink
  'rgb(124 58 237)', // violet
  'rgb(37 99 235)', // blue
  'rgb(16 185 129)', // emerald
  'rgb(107 114 128)', // gray
]

/**
 * Топ-5 источников клиентов по проценту от всей базы. clients.source —
 * свободное поле (юзер сам вписывает). Никакого humanize / маппинга —
 * показываем РОВНО то что вписали в карточке клиента (по запросу
 * владельца: если он завёл «Сарафан» и «сарафан» — это будут две разные
 * строки, что прозрачнее «магической» нормализации).
 *
 * Null/пустые группируются как «Прочее».
 */
export function computeMarketingSources(
  clients: Array<Pick<ClientRow, 'source'>>,
): Array<{ name: string; pct: number; color: string }> {
  if (clients.length === 0) return []
  const bucket = new Map<string, number>()
  for (const c of clients) {
    const src = (c.source ?? '').trim() || 'Прочее'
    bucket.set(src, (bucket.get(src) ?? 0) + 1)
  }
  const total = clients.length
  return Array.from(bucket.entries())
    .map(([name, count]) => ({ name, pct: (count / total) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)
    .map((item, i) => ({ ...item, color: SOURCE_COLORS[i % SOURCE_COLORS.length]! }))
}

// ─── Операции: материалы / запись на сегодня / no-shows ───────────────────

/**
 * Процент материалов в норме (current_stock > min_stock и min_stock>0).
 * Если у позиции min_stock=0 — её считаем «в норме» (не отслеживается).
 */
export function computeMaterialsStockPct(
  items: Array<{ current_stock: number; min_stock: number }>,
): number | null {
  if (items.length === 0) return null
  const ok = items.filter((i) => i.min_stock === 0 || i.current_stock > i.min_stock).length
  return (ok / items.length) * 100
}

/** Кол-во записей на сегодня (любой статус — pending + paid). */
export function computeTodayAppointments(
  visits: Array<Pick<VisitRow, 'visit_at' | 'status'>>,
  now: Date = new Date(),
): number {
  const day0 = new Date(now)
  day0.setHours(0, 0, 0, 0)
  const day1 = new Date(day0)
  day1.setDate(day1.getDate() + 1)
  return visits.filter((v) => {
    if (v.status === 'cancelled') return false
    const t = new Date(v.visit_at).getTime()
    return t >= day0.getTime() && t < day1.getTime()
  }).length
}

/** Пропуски / опоздания: visits.status === 'cancelled' за период. */
export function computeNoShowsCount(visits: Array<Pick<VisitRow, 'status'>>): number {
  return visits.filter((v) => v.status === 'cancelled').length
}

// ─── Online bookings % ────────────────────────────────────────────────────

/** Процент визитов от онлайн-источников (booksy, online, etc). */
export function computeOnlineBookingsPct(visits: Array<Pick<VisitRow, 'source'>>): number | null {
  if (visits.length === 0) return null
  const online = visits.filter((v) => {
    const s = (v.source ?? '').toLowerCase()
    return s.includes('booksy') || s.includes('online') || s.includes('web')
  }).length
  return (online / visits.length) * 100
}

// ─── Топ мастера: рейтинг / отзывы ────────────────────────────────────────

/** Средний рейтинг по reviews за период. */
export function computeAvgRating(
  reviews: Array<{ rating: number | null; posted_at: string }>,
  range: { start: string; end: string },
): { avg: number | null; count: number } {
  const inRange = reviews.filter(
    (r) => r.posted_at >= range.start && r.posted_at < range.end && r.rating != null,
  )
  if (inRange.length === 0) return { avg: null, count: 0 }
  const sum = inRange.reduce((acc, r) => acc + (r.rating ?? 0), 0)
  return { avg: sum / inRange.length, count: inRange.length }
}

// ─── Local insights (когда таблица insights пустая) ───────────────────────

export type LocalInsight = {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
}

/**
 * «Лёгкие» инсайты которые мы можем посчитать на лету из текущих агрегатов
 * — без RPC к таблице insights. Используется как fallback, когда таблица
 * пустая (новый салон).
 */
export function computeLocalInsights(input: {
  revenueCents: number
  expenseCents: number
  profitCents: number
  prevRevenueCents: number | null
  cashBalanceCents: number | null
  needsReactivation: number
  lowStockCount: number
  occupancyPct: number | null
}): LocalInsight[] {
  const out: LocalInsight[] = []
  if (input.cashBalanceCents != null && input.cashBalanceCents < 0) {
    out.push({
      id: 'cash-negative',
      severity: 'critical',
      title: 'Касса в минусе',
      body: 'Сумма по всем счетам отрицательная. Проверь свежие списания и переводы.',
    })
  }
  if (input.profitCents < 0) {
    out.push({
      id: 'profit-negative',
      severity: 'critical',
      title: 'Расходы превысили выручку',
      body: `Прибыль ${Math.round(input.profitCents / 100)} — посмотри в P&L, какие категории расходов выросли сильнее всего.`,
    })
  }
  if (
    input.prevRevenueCents != null &&
    input.prevRevenueCents > 0 &&
    input.revenueCents < input.prevRevenueCents * 0.7
  ) {
    const dropPct = Math.round((1 - input.revenueCents / input.prevRevenueCents) * 100)
    out.push({
      id: 'revenue-drop',
      severity: 'warning',
      title: `Выручка упала на ${dropPct}% к прошлому месяцу`,
      body: 'Посмотри запись на ближайшие 2 недели и активность по каналам в Маркетинге.',
    })
  }
  if (input.occupancyPct != null && input.occupancyPct < 50) {
    out.push({
      id: 'occupancy-low',
      severity: 'warning',
      title: 'Загрузка мастеров ниже 50%',
      body: 'Часть рабочего времени простаивает — подходящий момент для рекламной кампании или акции для постоянных клиентов.',
    })
  }
  if (input.needsReactivation > 0) {
    out.push({
      id: 'reactivation',
      severity: 'info',
      title: `${input.needsReactivation} клиентов давно не возвращались`,
      body: 'Запусти рассылку с напоминанием или индивидуальной скидкой — стоимость реактивации в 5× дешевле, чем привлечение нового клиента.',
    })
  }
  if (input.lowStockCount > 0) {
    out.push({
      id: 'low-stock',
      severity: 'warning',
      title: `${input.lowStockCount} позиций ниже минимума`,
      body: 'Без закупки часть услуг может остановиться. Раздел «Склад» — отметь что заказать.',
    })
  }
  return out.slice(0, 3)
}

// ─── Helpers: рабочие дни в месяце ────────────────────────────────────────

/** Считает рабочие дни (пн-сб) в указанном диапазоне. */
export function workingDaysInRange(start: Date, end: Date): number {
  let count = 0
  const cur = new Date(start)
  cur.setHours(0, 0, 0, 0)
  const endTs = end.getTime()
  while (cur.getTime() <= endTs) {
    const dow = cur.getDay()
    if (dow !== 0) count++ // skip Sunday only
    cur.setDate(cur.getDate() + 1)
  }
  return Math.max(1, count)
}

export type { StaffRow }
