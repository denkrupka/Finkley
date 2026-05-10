import type { ClientRow } from '@/hooks/useClients'

/**
 * RFM-lite сегменты для клиентов салона. Считаются на лету из visit_count
 * и last_visit_at, без отдельного RPC. Логика подобрана под typical
 * cadence визитов в beauty-индустрии (стрижка ~раз в 4-8 недель).
 *
 *   new        — visit_count == 1, last_visit < 60 дней назад
 *   regular    — visit_count >= 2 и last_visit < 60 дней назад
 *   lapsed     — last_visit 60..180 дней назад (или ни одного, но создан > 30 дней назад)
 *   churned    — last_visit > 180 дней назад
 *   prospect   — никогда не был, создан < 30 дней назад
 */
export type ClientSegment = 'new' | 'regular' | 'lapsed' | 'churned' | 'prospect'

const DAY = 24 * 60 * 60 * 1000

export function clientSegment(
  c: Pick<ClientRow, 'visit_count' | 'last_visit_at' | 'created_at'>,
): ClientSegment {
  const now = Date.now()
  const last = c.last_visit_at ? new Date(c.last_visit_at).getTime() : null
  const created = new Date(c.created_at).getTime()

  if (last === null) {
    // Не был ни разу
    return now - created < 30 * DAY ? 'prospect' : 'lapsed'
  }
  const daysSince = (now - last) / DAY
  if (daysSince > 180) return 'churned'
  if (daysSince > 60) return 'lapsed'
  if (c.visit_count >= 2) return 'regular'
  return 'new'
}

/**
 * Дней до ближайшего дня рождения (если он в окне next_days_within).
 * Возвращает null если бд нет birthday или если он не в ближайшем окне.
 */
export function daysToBirthday(birthdayIso: string | null, withinDays = 14): number | null {
  if (!birthdayIso) return null
  // birthday хранится как date — без года это всё равно определяется
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const bd = new Date(birthdayIso)
  // Берём ДР в этом году; если уже прошёл — переносим на следующий
  const thisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate())
  const next =
    thisYear < today ? new Date(today.getFullYear() + 1, bd.getMonth(), bd.getDate()) : thisYear
  const diff = Math.round((next.getTime() - today.getTime()) / DAY)
  return diff <= withinDays ? diff : null
}

export function daysSinceLastVisit(lastIso: string | null): number | null {
  if (!lastIso) return null
  return Math.round((Date.now() - new Date(lastIso).getTime()) / DAY)
}
