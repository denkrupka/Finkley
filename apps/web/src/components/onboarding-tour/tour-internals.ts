import type { LucideIcon } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'

export type TourStep = {
  id: string
  icon: LucideIcon
  titleKey: string
  bodyKey: string
  ctaKey?: string
  ctaPath?: (salonId: string) => string
  /** CSS-селектор для spotlight'а; если элемент не найден — fallback на
   *  центрированную модалку. */
  target?: string
  /** Какие роли видят этот шаг. По умолчанию — все. */
  roles?: Array<'owner' | 'admin' | 'staff' | 'accountant'>
}

/**
 * Возвращает bounding rect элемента по селектору + ре-измеряет при scroll/resize.
 * Если элемент за пределами viewport — auto-scroll к нему.
 */
export function useTargetRect(selector: string | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (!selector) {
      setRect(null)
      return
    }
    function measure() {
      const el = document.querySelector(selector!)
      if (!el) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > window.innerHeight) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      requestAnimationFrame(() => {
        const r2 = el.getBoundingClientRect()
        setRect(r2)
      })
    }
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    const interval = window.setInterval(measure, 800)
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearInterval(interval)
    }
  }, [selector])
  return rect
}

/** Позиция tooltip'а относительно target (снизу→сверху→справа→слева). */
export function tooltipPosition(target: DOMRect | null, tooltipW = 420, tooltipHEstimate = 280) {
  if (!target || typeof window === 'undefined') return { left: 0, top: 0 }
  const margin = 16
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = target.top + target.height + margin
  let placement: 'bottom' | 'top' | 'right' | 'left' = 'bottom'

  if (top + tooltipHEstimate > vh - 8) {
    placement = 'top'
    top = target.top - tooltipHEstimate - margin
  }
  if (top < 8) {
    placement = 'right'
    top = Math.max(8, Math.min(vh - tooltipHEstimate - 8, target.top))
  }

  let left = target.left + target.width / 2 - tooltipW / 2
  if (placement === 'right') {
    left = target.left + target.width + margin
    if (left + tooltipW > vw - 8) {
      placement = 'left'
      left = target.left - tooltipW - margin
    }
  }
  left = Math.max(8, Math.min(vw - tooltipW - 8, left))
  return { left, top }
}
