/**
 * Pure ICS-generation helpers — shadow для supabase/functions/calendar-feed/index.ts.
 *
 * RFC 5545: text/calendar serialization. Edge function на Deno нельзя
 * импортировать в Vite-сборку, поэтому держим shadow inline. Tests защищают
 * от дрейфа реализаций.
 */

/** Эскейпим строку для iCal: \\ \, \n */
export function ic(s: string): string {
  return (s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
}

/** UTC ISO → ICS DATE-TIME 20260508T123000Z */
export function icsTime(iso: string): string {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${y}${mo}${da}T${h}${mi}${s}Z`
}

/** Wrap длинных строк в 75-octet lines (RFC 5545). */
export function fold(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let i = 0
  while (i < line.length) {
    chunks.push((i === 0 ? '' : ' ') + line.slice(i, i + 73))
    i += 73
  }
  return chunks.join('\r\n')
}

/**
 * DTEND для визита: start + duration_min минут (или 60 если null).
 * Соответствует логике calendar-feed: визит без duration_min рендерится как 60 мин.
 */
export function dtEndForVisit(startIso: string, durationMin: number | null | undefined): string {
  const start = new Date(startIso)
  const dur = durationMin && durationMin > 0 ? durationMin : 60
  return new Date(start.getTime() + dur * 60_000).toISOString()
}
