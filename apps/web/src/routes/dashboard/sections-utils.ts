import { format, startOfDay } from 'date-fns'

/** Группирует визиты по дню в массив { date, cents }, сортирует по дате. */
export function aggregateDailyRevenue(
  visits: Array<{
    visit_at: string
    status?: string
    amount_cents: number
    paid_amount_cents?: number | null
  }>,
): Array<{ date: string; cents: number }> {
  const buckets = new Map<string, number>()
  for (const v of visits) {
    if (v.status && v.status !== 'paid') continue
    const day = format(startOfDay(new Date(v.visit_at)), 'yyyy-MM-dd')
    const cents = v.paid_amount_cents ?? v.amount_cents
    buckets.set(day, (buckets.get(day) ?? 0) + cents)
  }
  return Array.from(buckets.entries())
    .map(([date, cents]) => ({ date, cents }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
