import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSalonMembership } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'

import { tooltipPosition, useTargetRect, type TourStep } from './tour-internals'

const STORAGE_PREFIX = 'finkley:tour:page:'

type Role = 'owner' | 'admin' | 'staff' | 'accountant'

/**
 * T46 — переиспользуемый per-page тур. Каждая страница определяет свой
 * набор `steps` и уникальный `name` для localStorage-флага. После первого
 * показа — флаг сохраняется, повторно не открывается до сброса.
 *
 * Запустить повторно — кнопка «Тур» на странице или query `?tour=1`.
 *
 * Per-role: шаги без `roles` видят все; с `roles` — только указанные.
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
    <TourRenderer
      step={step}
      visible={visible}
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

type RendererProps = {
  step: TourStep
  visible: TourStep[]
  stepIndex: number
  isFirst: boolean
  isLast: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onCta: () => void
  t: (k: string) => string
}

export function TourRenderer({
  step,
  visible,
  stepIndex,
  isFirst,
  isLast,
  onNext,
  onBack,
  onSkip,
  onCta,
  t,
}: RendererProps) {
  const Icon = step.icon
  const targetRect = useTargetRect(step.target)
  const hasSpotlight = !!targetRect
  const tooltipPos = tooltipPosition(targetRect)

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {hasSpotlight && targetRect ? (
        <>
          <div
            className="absolute bg-black/55 backdrop-blur-[1px]"
            style={{ left: 0, top: 0, right: 0, height: Math.max(0, targetRect.top - 6) }}
          />
          <div
            className="absolute bg-black/55 backdrop-blur-[1px]"
            style={{
              left: 0,
              top: targetRect.top - 6,
              width: Math.max(0, targetRect.left - 6),
              height: targetRect.height + 12,
            }}
          />
          <div
            className="absolute bg-black/55 backdrop-blur-[1px]"
            style={{
              left: targetRect.left + targetRect.width + 6,
              top: targetRect.top - 6,
              right: 0,
              height: targetRect.height + 12,
            }}
          />
          <div
            className="absolute bg-black/55 backdrop-blur-[1px]"
            style={{
              left: 0,
              top: targetRect.top + targetRect.height + 6,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            className="ring-primary/80 pointer-events-none absolute rounded-md ring-2 ring-offset-2 ring-offset-transparent"
            style={{
              left: targetRect.left - 4,
              top: targetRect.top - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      )}

      <div
        className={cn(
          'bg-card shadow-finxl absolute w-[min(420px,92vw)] rounded-xl p-5 sm:p-6',
          !hasSpotlight && 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
        )}
        style={hasSpotlight ? { left: tooltipPos.left, top: tooltipPos.top } : undefined}
      >
        <button
          type="button"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground absolute right-3 top-3 grid size-7 place-items-center rounded-md"
          aria-label={t('tour.close')}
        >
          <X className="size-4" strokeWidth={1.7} />
        </button>

        <div className="mb-4 flex items-center gap-1.5">
          {visible.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === stepIndex
                  ? 'bg-primary w-6'
                  : i < stepIndex
                    ? 'bg-primary/50 w-1.5'
                    : 'bg-border w-1.5',
              )}
            />
          ))}
        </div>

        <div className="bg-brand-teal-soft text-brand-teal-deep mb-3 grid size-11 place-items-center rounded-xl">
          <Icon className="size-5" strokeWidth={1.7} />
        </div>

        <h2 id="tour-title" className="text-brand-navy text-lg font-bold tracking-tight">
          {t(step.titleKey)}
        </h2>
        <p className="text-foreground/80 mt-2 whitespace-pre-line text-sm leading-relaxed">
          {t(step.bodyKey)}
        </p>

        <div className="mt-5 flex flex-col gap-2">
          {step.ctaKey && step.ctaPath ? (
            <Button type="button" size="md" onClick={onCta}>
              {t(step.ctaKey)}
            </Button>
          ) : null}
          <div className="flex items-center gap-2">
            {!isFirst ? (
              <Button type="button" size="md" variant="outline" onClick={onBack} className="flex-1">
                {t('tour.back')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="md"
              variant={step.ctaKey ? 'outline' : 'primary'}
              onClick={onNext}
              className="flex-1"
            >
              {isLast ? t('tour.finish') : t('tour.next')}
            </Button>
          </div>
          {!isLast ? (
            <button
              type="button"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground self-center text-xs"
            >
              {t('tour.skip')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
