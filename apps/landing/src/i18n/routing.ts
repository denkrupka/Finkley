/**
 * Pure-хелперы локализованных путей для SSG-лендинга. Без Astro-импортов —
 * юнит-тестируются в routing.test.ts (через vitest apps/web).
 *
 * Модель маршрутов (root-deploy, без base):
 *   - RU (дефолт) живёт на корне: `/`, `/pricing`, `/features/ai/`.
 *   - PL живёт под `/pl/`: `/pl/`, `/pl/pricing`, `/pl/features/ai/`.
 *
 * hreflang делаем реципрокным ТОЛЬКО для страниц, у которых реально есть обе
 * локали (Layout получает список `locales`). Для непереведённых страниц pl-
 * альтернатива не эмитится — иначе hreflang указывал бы на 404.
 */

export const LOCALES = ['ru', 'pl'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'

const PL_PREFIX = '/pl'

/** Локализованный путь: RU — как есть; PL — с префиксом /pl. */
export function localizedPath(basePath: string, locale: Locale): string {
  const path = basePath || '/'
  if (locale === DEFAULT_LOCALE) return path
  if (path === '/') return `${PL_PREFIX}/`
  return `${PL_PREFIX}${path}`
}

/** Убирает префикс локали → канонический RU-путь. */
export function stripLocale(path: string): string {
  if (path === PL_PREFIX || path === `${PL_PREFIX}/`) return '/'
  if (path.startsWith(`${PL_PREFIX}/`)) return path.slice(PL_PREFIX.length)
  return path || '/'
}

/** Локаль текущего пути (по префиксу). */
export function localeFromPath(path: string): Locale {
  if (path === PL_PREFIX || path === `${PL_PREFIX}/` || path.startsWith(`${PL_PREFIX}/`))
    return 'pl'
  return 'ru'
}

export type Alternate = { hreflang: string; path: string }

/**
 * Набор hreflang-альтернатив для страницы. `locales` — локали, в которых
 * страница реально существует (минимум ['ru']). Возвращает self+reciprocal +
 * x-default (→ RU). Каждая запись self-referencing, ни одна не указывает на
 * несуществующую локаль.
 */
export function alternatesFor(basePath: string, locales: readonly Locale[] = ['ru']): Alternate[] {
  const base = stripLocale(basePath)
  const out: Alternate[] = []
  for (const loc of locales) {
    out.push({ hreflang: loc, path: localizedPath(base, loc) })
  }
  // x-default → дефолтная (RU) версия, если она есть.
  if (locales.includes(DEFAULT_LOCALE)) {
    out.push({ hreflang: 'x-default', path: localizedPath(base, DEFAULT_LOCALE) })
  }
  return out
}
