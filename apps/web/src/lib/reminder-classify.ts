/**
 * Хелперы классификации платежей по сроку. Логика дублируется в
 * supabase/functions/payment-reminders/index.ts (Deno cannot import
 * from apps/web). Чтобы покрыть тестами — вынесли pure-функции сюда.
 *
 * При изменении синхронизировать оба места.
 */

export type ReminderBucket =
  | 'payment_due_2d'
  | 'payment_due_1d'
  | 'payment_due_today'
  | 'payment_overdue'

/**
 * Сколько дней (integer) от today до dueDate. Положительное = в будущем.
 * Оба входа — yyyy-mm-dd. Игнорируем TZ — считаем по UTC midnight.
 */
export function dueOffset(dueDate: string, today: string): number {
  const a = new Date(`${dueDate}T00:00:00Z`).getTime()
  const b = new Date(`${today}T00:00:00Z`).getTime()
  return Math.round((a - b) / 86400000)
}

/**
 * Маппит offset → bucket уведомления. null если не нужно слать
 * (например, due_date = today + 5).
 */
export function classifyOffset(offset: number): ReminderBucket | null {
  if (offset === 2) return 'payment_due_2d'
  if (offset === 1) return 'payment_due_1d'
  if (offset === 0) return 'payment_due_today'
  if (offset < 0) return 'payment_overdue'
  return null
}
