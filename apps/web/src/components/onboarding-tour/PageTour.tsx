import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { useSalonMembership } from '@/hooks/useSalons'

import { TourStage } from './TourStage'
import { type TourStep } from './tour-internals'

const STORAGE_PREFIX = 'finkley:tour:page:'
/** Главный OnboardingTour key — должен быть пройден/пропущен ДО любого
 *  per-page тура. Иначе два overlay'я накладываются (image #15). */
const MAIN_TOUR_KEY = 'finkley:tour:dismissed'

type Role = 'owner' | 'admin' | 'staff' | 'accountant'

/**
 * T46 — переиспользуемый per-page тур. Каждая страница определяет свой
 * набор `steps` и уникальный `name` для localStorage-флага. После первого
 * показа — флаг сохраняется, повторно не открывается до сброса.
 *
 * Запустить повторно — кнопка «Тур» на странице или query `?tour=1`.
 *
 * Per-role: шаги без `roles` видят все; с `roles` — только указанные.
 *
 * T214 — рендер делегирован общему `<TourStage>`, чтобы локальный тур
 * выглядел идентично главному `OnboardingTour`: spotlight overlay вокруг
 * элемента-таргета + tooltip рядом с ним (а не центрированная модалка).
 * Когда у шага задан `target`, но элемент не найден на странице — будет
 * показан искусственный spotlight в центре с пунктирным кольцом, чтобы
 * юзер видел что речь идёт о фиче которая живёт где-то ещё.
 */
export function PageTour({
  name,
  steps,
  force = false,
  onClose,
}: {
  /** Уникальный идентификатор тура для localStorage: tour:page:<name>. */
  name: string
  steps: TourStep[]
  /** Игнорировать localStorage и принудительно показать (для re-launch из UI). */
  force?: boolean
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: membership } = useSalonMembership(salonId)
  const role: Role = (membership?.role as Role | undefined) ?? 'owner'
  const visible = steps.filter((s) => !s.roles || s.roles.includes(role))

  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (force) {
      setOpen(true)
      setStepIndex(0)
      return
    }
    try {
      // Сначала проверяем главный тур — пока он не пройден, per-page
      // туры не запускаются автоматически (только через force=true).
      const mainTourDone = localStorage.getItem(MAIN_TOUR_KEY) === '1'
      if (!mainTourDone) return
      const dismissed = localStorage.getItem(STORAGE_PREFIX + name) === '1'
      if (!dismissed) setOpen(true)
    } catch {
      // ignore
    }
  }, [name, force])

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_PREFIX + name, '1')
    } catch {
      // ignore
    }
    setOpen(false)
    onClose?.()
  }

  if (!open || visible.length === 0) return null

  const step = visible[Math.min(stepIndex, visible.length - 1)]!
  const isLast = stepIndex >= visible.length - 1
  const isFirst = stepIndex === 0

  function next() {
    if (isLast) dismiss()
    else setStepIndex((i) => i + 1)
  }

  function tryCta() {
    if (step.ctaPath && salonId) {
      dismiss()
      navigate(step.ctaPath(salonId))
    }
  }

  return (
    <TourStage
      step={step}
      steps={visible}
      stepIndex={stepIndex}
      isFirst={isFirst}
      isLast={isLast}
      onNext={next}
      onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
      onSkip={dismiss}
      onCta={tryCta}
      t={t}
    />
  )
}
