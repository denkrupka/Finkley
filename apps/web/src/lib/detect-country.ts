/**
 * Auto-detect страны юзера по IP — для предзаполнения поля «страна» в
 * онбординге. Без него польский владелец видит дефолт PL, но эстонский
 * или чешский — тоже PL, и обижается.
 *
 * Используется бесплатный ipapi.co (1000 req/day без ключа). Если API
 * упал / лимит — возвращаем null, форма падает на свой дефолт (PL).
 *
 * Запрос делается через abort signal с timeout 3 сек — не должны
 * блокировать загрузку онбординга если сеть медленная.
 */

const SUPPORTED = ['PL', 'DE', 'LT', 'CZ', 'EE'] as const

export type DetectedCountry = (typeof SUPPORTED)[number]

export async function detectCountryByIp(): Promise<DetectedCountry | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch('https://ipapi.co/country/', {
      signal: controller.signal,
      headers: { Accept: 'text/plain' },
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const code = (await res.text()).trim().toUpperCase()
    if (SUPPORTED.includes(code as DetectedCountry)) return code as DetectedCountry
    return null
  } catch {
    return null
  }
}
