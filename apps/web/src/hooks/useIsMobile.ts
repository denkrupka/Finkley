import { useEffect, useState } from 'react'

/**
 * Mobile-audit hook (2026-05-30).
 *
 * Возвращает `true` если viewport <= 639px (Tailwind sm breakpoint).
 * Подписывается на `matchMedia` change. SSR-safe (default false).
 *
 * Используется в местах где нужно адаптивно менять числовые значения,
 * которые CSS не покрывает (например, COL_WIDTH_PX в календаре).
 */
export function useIsMobile(maxWidthPx = 639): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`)
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [maxWidthPx])

  return isMobile
}
