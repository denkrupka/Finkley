import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

import { tooltipPosition, useTargetRect, type TourStep } from './tour-internals'

/**
 * Унифицированный рендерер тура (overlay + spotlight + tooltip) — общий для
 * главного OnboardingTour и для per-page PageTour. Логика и UI одинаковы:
 *
 * 1. Если у шага задан `target` и элемент найден на DOM — рисуем 4 затемняющих
 *    div'а вокруг bbox + сплошное primary-кольцо. Tooltip позиционируется
 *    через `getBoundingClientRect` (снизу→сверху→справа→слева, с clamp'ом
 *    к viewport).
 * 2. Если `target` задан, но элемент не найден на этой странице (например,
 *    шаг про FAB на странице без FAB) — рисуем «искусственный» spotlight
 *    в центре viewport с ПУНКТИРНЫМ кольцом, чтобы юзер видел: «реального
 *    элемента тут нет, просто инфо-шаг». Tooltip позиционируется относительно
 *    этого fake-rect'а. **Никогда не fallback'имся на центрированную модалку**
 *    — это была главная разница между OnboardingTour и PageTour, из-за неё
 *    локальные туры выглядели иначе (T214+).
 * 3. Если `target` вообще не задан — лёгкий dim 15% без кольца, tooltip
 *    в верхней четверти экрана (как welcome-шаг главного тура).
 */
export function TourStage({
  step,
  steps,
  stepIndex,
  isFirst,
  isLast,
  onNext,
  onBack,
  onSkip,
  onCta,
  t,
}: {
  step: TourStep
  steps: TourStep[]
  stepIndex: number
  isFirst: boolean
  isLast: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onCta: () => void
  t: (k: string) => string
}) {
  const Icon = step.icon
  const realRect = useTargetRect(step.target)

  // Артефакт-rect для случая «target задан, но элемент не найден на странице».
  // SSR-safe: window может отсутствовать.
  const isArtificial = !realRect && !!step.target
  const targetRect: DOMRect | null =
    realRect ??
    (step.target && typeof window !== 'undefined'
      ? (() => {
          const w = window.innerWidth
          const h = window.innerHeight
          const size = Math.min(200, w * 0.4)
          const left = (w - size) / 2
          const top = h * 0.18
          return new DOMRect(left, top, size, size)
        })()
      : null)
  const hasSpotlight = !!targetRect

  const tooltipPos = tooltipPosition(targetRect)

  return (
    <div
      className={cn('fixed inset-0 z-50', hasSpotlight ? '' : 'pointer-events-none')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {hasSpotlight && targetRect ? (
        <>
          {/* Spotlight overlay — 4 div'а вокруг bbox = «вырез» через box-shadow
              без mask-svg (работает везде, включая Safari < 15). */}
          <div
            className="absolute bg-black/55 backdrop-blur-[1px] transition-opacity"
            style={{ left: 0, top: 0, right: 0, height: Math.max(0, targetRect.top - 6) }}
          />
          <div
            className="absolute bg-black/55 backdrop-blur-[1px] transition-opacity"
            style={{
              left: 0,
              top: targetRect.top - 6,
              width: Math.max(0, targetRect.left - 6),
              height: targetRect.height + 12,
            }}
          />
          <div
            className="absolute bg-black/55 backdrop-blur-[1px] transition-opacity"
            style={{
              left: targetRect.left + targetRect.width + 6,
              top: targetRect.top - 6,
              right: 0,
              height: targetRect.height + 12,
            }}
          />
          <div
            className="absolute bg-black/55 backdrop-blur-[1px] transition-opacity"
            style={{
              left: 0,
              top: targetRect.top + targetRect.height + 6,
              right: 0,
              bottom: 0,
            }}
          />
          {/* Кольцо. Для искусственного fallback'а — пунктирное полупрозрачное. */}
          <div
            className={cn(
              'pointer-events-none absolute rounded-md ring-offset-2 ring-offset-transparent transition-all',
              isArtificial ? 'ring-primary/40' : 'ring-primary/80 ring-2',
            )}
            style={{
              left: targetRect.left - 4,
              top: targetRect.top - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
              ...(isArtificial
                ? {
                    outline: '2px dashed var(--tour-spotlight-color, rgba(13, 148, 136, 0.6))',
                  }
                : {}),
            }}
          />
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/15" />
      )}

      <div
        className={cn(
          'bg-card shadow-finxl pointer-events-auto absolute w-[min(420px,92vw)] rounded-xl p-5 sm:p-6',
          !hasSpotlight && 'left-1/2 top-[12%] -translate-x-1/2',
        )}
        style={
          hasSpotlight
            ? {
                left: tooltipPos.left,
                top: tooltipPos.top,
              }
            : undefined
        }
      >
        <button
          type="button"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground absolute right-3 top-3 grid size-7 place-items-center rounded-md"
          aria-label={t('tour.close')}
        >
          <X className="size-4" strokeWidth={1.7} />
        </button>

        {/* Progress dots */}
        <div className="mb-4 flex items-center gap-1.5">
          {steps.map((_, i) => (
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
