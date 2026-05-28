import {
  Banknote,
  Bell,
  Calendar,
  type LucideIcon,
  Plug,
  Plus,
  Receipt,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSalonMembership } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'

const STORAGE_KEY = 'finkley:tour:dismissed'

type Step = {
  id: string
  icon: LucideIcon
  titleKey: string
  bodyKey: string
  ctaKey?: string
  ctaPath?: (salonId: string) => string
  /** T45 — CSS-селектор элемента для spotlight'а. Если задан — overlay
   *  оставляет вокруг него прозрачный «вырез» и показывает tooltip рядом.
   *  Если элемент не найден на DOM — fallback на верхнюю четверть. */
  target?: string
  /** T127 — путь куда автонавигировать ПЕРЕД measure'ом target. Если
   *  target живёт на другой странице, юзер увидит как тур сам переходит
   *  туда + spotlight подсвечивает нужный элемент.
   *  Релативный путь без salonId, salonId подставляется автоматом. */
  navigatePath?: string
  /** Какие роли видят этот шаг. По умолчанию — все. */
  roles?: Array<'owner' | 'admin' | 'staff' | 'accountant'>
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    icon: Sparkles,
    titleKey: 'tour.steps.welcome.title',
    bodyKey: 'tour.steps.welcome.body',
    // T127 — фокус на логотипе/sidebar чтобы spotlight был и на welcome'е.
    target: '[data-tour="sidebar"]',
    navigatePath: '/dashboard',
  },
  {
    id: 'nav',
    icon: Plug,
    titleKey: 'tour.steps.nav.title',
    bodyKey: 'tour.steps.nav.body',
    target: '[data-tour="sidebar"]',
    navigatePath: '/dashboard',
  },
  {
    id: 'visit',
    icon: Plus,
    titleKey: 'tour.steps.visit.title',
    bodyKey: 'tour.steps.visit.body',
    ctaKey: 'tour.steps.visit.cta',
    ctaPath: (id) => `/${id}/income?tab=visits`,
    target: '[data-tour="fab-add"]',
    navigatePath: '/income?tab=visits',
  },
  {
    id: 'expense',
    icon: Receipt,
    titleKey: 'tour.steps.expense.title',
    bodyKey: 'tour.steps.expense.body',
    ctaKey: 'tour.steps.expense.cta',
    ctaPath: (id) => `/${id}/expenses`,
    target: '[data-tour-nav="expenses"]',
    navigatePath: '/expenses',
    roles: ['owner', 'admin', 'accountant'],
  },
  {
    id: 'retail',
    icon: Banknote,
    titleKey: 'tour.steps.retail.title',
    bodyKey: 'tour.steps.retail.body',
    target: '[data-tour-nav="income"]',
    navigatePath: '/income?tab=sales',
    roles: ['owner', 'admin'],
  },
  {
    id: 'calendar',
    icon: Calendar,
    titleKey: 'tour.steps.calendar.title',
    bodyKey: 'tour.steps.calendar.body',
    target: '[data-tour-nav="reports"]',
    navigatePath: '/reports',
  },
  {
    id: 'notifications',
    icon: Bell,
    titleKey: 'tour.steps.notifications.title',
    bodyKey: 'tour.steps.notifications.body',
    target: '[data-tour="bell"]',
  },
  {
    id: 'integrations',
    icon: Plug,
    titleKey: 'tour.steps.integrations.title',
    bodyKey: 'tour.steps.integrations.body',
    ctaKey: 'tour.steps.integrations.cta',
    ctaPath: (id) => `/${id}/settings?tab=integrations`,
    target: '[data-tour-nav="settings"]',
    navigatePath: '/settings?tab=integrations',
    roles: ['owner', 'admin'],
  },
  {
    id: 'team',
    icon: Users,
    titleKey: 'tour.steps.team.title',
    bodyKey: 'tour.steps.team.body',
    ctaKey: 'tour.steps.team.cta',
    ctaPath: (id) => `/${id}/settings/team`,
    target: '[data-tour-nav="settings"]',
    navigatePath: '/settings?tab=team',
    roles: ['owner'],
  },
]

/**
 * T45 — стартовый тур с spotlight overlay вокруг ключевых UI-элементов
 * и per-role шагами (Мастер видит короткий тур: welcome → nav → visit →
 * calendar → notifications; Owner — все 9 шагов с админскими разделами).
 *
 * Spotlight реализован через overlay с box-shadow inset — нет react-joyride
 * зависимости. Если data-tour атрибут не найден на странице — шаг
 * fallback'ится на центрированную модалку.
 *
 * Показывается раз в жизни юзера (localStorage). Повторный запуск — через
 * /help → «Показать тур» (?showTour=1 в query).
 */
export function OnboardingTour({ salonId, force = false }: { salonId: string; force?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: membership } = useSalonMembership(salonId)
  const role = (membership?.role ?? 'owner') as 'owner' | 'admin' | 'staff' | 'accountant'
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  // Фильтруем шаги по роли текущего юзера.
  const steps = STEPS.filter((s) => !s.roles || s.roles.includes(role))

  useEffect(() => {
    if (force) {
      setOpen(true)
      setStepIndex(0)
      return
    }
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY) === '1'
      if (!dismissed) setOpen(true)
    } catch {
      // localStorage недоступен (SSR / private mode) — не показываем
    }
  }, [force])

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // ignore
    }
    setOpen(false)
  }

  const step = steps[Math.min(stepIndex, steps.length - 1)]!
  const isLast = stepIndex >= steps.length - 1
  const isFirst = stepIndex === 0

  // T127 — auto-navigate перед measure target. Каждый шаг может иметь
  // navigatePath; если он отличается от текущего pathname — навигируем
  // туда. useTargetRect перемеряет каждые 800ms и сам поймает элемент
  // после нового рендера страницы.
  useEffect(() => {
    if (!open || !step.navigatePath) return
    const full = `/${salonId}${step.navigatePath}`
    const current = window.location.pathname + window.location.search
    const fullPath = full.split('?')[0]!
    if (current.startsWith(fullPath)) return
    navigate(full)
  }, [open, stepIndex, step.navigatePath, salonId, navigate])

  if (!open) return null

  function next() {
    if (isLast) dismiss()
    else setStepIndex((i) => i + 1)
  }

  function tryCta() {
    if (step.ctaPath) {
      dismiss()
      navigate(step.ctaPath(salonId))
    }
  }

  return (
    <TourRenderer
      step={step}
      steps={steps}
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

type TourRendererProps = {
  step: Step
  steps: Step[]
  stepIndex: number
  isFirst: boolean
  isLast: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onCta: () => void
  t: (k: string) => string
}

function TourRenderer({
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
}: TourRendererProps) {
  const Icon = step.icon
  const targetRect = useTargetRect(step.target)
  const hasSpotlight = !!targetRect

  // Tooltip позиция — снизу элемента, прижата к viewport.
  const tooltipPos = useTooltipPosition(targetRect)

  return (
    <div
      className={cn(
        'fixed inset-0 z-50',
        // На шаге без target overlay не перехватывает клики — иначе юзер
        // не может взаимодействовать с интерфейсом (это «лёгкий» режим).
        // На шаге со spotlight overlay полупрозрачный и перехватывает
        // клики везде, кроме самого spotlight'a (вырез — четыре div'а
        // вокруг target, между ними «дырка»).
        hasSpotlight ? '' : 'pointer-events-none',
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {hasSpotlight && targetRect ? (
        <>
          {/* Spotlight overlay — затемняет всё кроме bbox через 4 div'а
              (proper cutout без mask svg; работает в любом браузере). */}
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
          {/* Кольцо вокруг подсвеченного элемента */}
          <div
            className="ring-primary/80 pointer-events-none absolute rounded-md ring-2 ring-offset-2 ring-offset-transparent transition-all"
            style={{
              left: targetRect.left - 4,
              top: targetRect.top - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />
        </>
      ) : (
        // T95 — лёгкий полупрозрачный dim для шагов без target. Юзер видит
        // что есть подсказка, но интерфейс не «выключается» как полноэкранной
        // модалкой. Click-through заблокирован contained tooltip.
        <div className="pointer-events-none absolute inset-0 bg-black/15" />
      )}

      {/* Tooltip / Modal — позиционируется относительно target либо в верхней
          четверти экрана как floating-card (раньше был центр — перекрывал
          важные UI элементы, FAB и т.д.). */}
      <div
        className={cn(
          'bg-card shadow-finxl pointer-events-auto absolute rounded-xl p-5 sm:p-6',
          hasSpotlight ? 'w-[min(420px,92vw)]' : 'w-[min(420px,92vw)]',
          // T126: fallback позиционирование — top-[12%], центр по X. Это
          // не перекрывает ни FAB (правый низ), ни sidebar (левый край).
          !hasSpotlight && 'left-1/2 top-[12%] -translate-x-1/2',
        )}
        style={
          hasSpotlight
            ? {
                left: tooltipPos.left,
                top: tooltipPos.top,
                transform: tooltipPos.transform,
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

// ─── Хуки позиционирования ────────────────────────────────────────────────

function useTargetRect(selector: string | undefined): DOMRect | null {
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
      // Scroll элемент в viewport если он за пределами (для мобильного).
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > window.innerHeight) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      // Перемеряем после возможного scroll.
      requestAnimationFrame(() => {
        const r2 = el.getBoundingClientRect()
        setRect(r2)
      })
    }
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    const interval = window.setInterval(measure, 800) // обновляем если DOM меняется
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearInterval(interval)
    }
  }, [selector])
  return rect
}

function useTooltipPosition(target: DOMRect | null) {
  const TOOLTIP_W = 420
  const TOOLTIP_H_ESTIMATE = 280
  if (!target) return { left: 0, top: 0, transform: '' }

  const margin = 16
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Пробуем снизу.
  let top = target.top + target.height + margin
  let placement: 'bottom' | 'top' | 'right' | 'left' = 'bottom'

  if (top + TOOLTIP_H_ESTIMATE > vh - 8) {
    // Если внизу не помещается — сверху.
    placement = 'top'
    top = target.top - TOOLTIP_H_ESTIMATE - margin
  }

  // Если ни снизу ни сверху — справа от элемента.
  if (top < 8) {
    placement = 'right'
    top = Math.max(8, Math.min(vh - TOOLTIP_H_ESTIMATE - 8, target.top))
  }

  // По горизонтали — центрируем относительно target, прижимаем к viewport.
  let left = target.left + target.width / 2 - TOOLTIP_W / 2
  if (placement === 'right') {
    left = target.left + target.width + margin
    if (left + TOOLTIP_W > vw - 8) {
      // справа не лезет — слева.
      placement = 'left'
      left = target.left - TOOLTIP_W - margin
    }
  }
  left = Math.max(8, Math.min(vw - TOOLTIP_W - 8, left))
  void placement

  return { left, top, transform: '' }
}
