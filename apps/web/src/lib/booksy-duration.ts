/**
 * Длительность визита в минутах из Booksy "YYYY-MM-DDTHH:MM" пары.
 * Дублирует логику supabase/functions/booksy-proxy/index.ts::computeDurationMin.
 * Используем фиксированный +00:00 — смещение TZ салона сокращается при вычитании.
 */
export function computeDurationMin(from?: string | null, till?: string | null): number | null {
  if (!from || !till) return null
  const fromMs = new Date(`${from}:00+00:00`).getTime()
  const tillMs = new Date(`${till}:00+00:00`).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(tillMs) || tillMs <= fromMs) return null
  return Math.round((tillMs - fromMs) / 60_000)
}
