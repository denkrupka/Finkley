/**
 * Anti-overwrite policy для Booksy snapshot sync (ADR-017 §4).
 * Дублирует логику supabase/functions/booksy-proxy/index.ts::shouldOverwrite.
 *
 * Чистая функция нужна для unit-тестов — Edge Function на Deno нельзя
 * импортировать в Vite-сборку.
 *
 * Решение когда перезаписать локальное значение из Booksy:
 *  - booksyPrev отсутствует (первый sync) → берём booksyNow
 *  - booksyNow === booksyPrev → Booksy не менял, не трогаем (undefined)
 *  - localValue === booksyPrev → юзер не менял, обновляем (booksyNow)
 *  - localValue !== booksyPrev → юзер переопределил, не трогаем (undefined)
 */
export function shouldOverwrite<T>(
  localValue: T,
  booksyPrev: T | undefined,
  booksyNow: T,
): T | undefined {
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  if (booksyPrev === undefined || booksyPrev === null) return booksyNow
  if (eq(booksyNow, booksyPrev)) return undefined
  if (eq(localValue, booksyPrev)) return booksyNow
  return undefined
}
