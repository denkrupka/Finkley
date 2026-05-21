import { Banknote, Calendar, type LucideIcon, Plug, Plus, Receipt, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

const STORAGE_KEY = 'finkley:tour:dismissed'

type Step = {
  id: string
  icon: LucideIcon
  titleKey: string
  bodyKey: string
  ctaKey?: string
  ctaPath?: (salonId: string) => string
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    icon: Sparkles,
    titleKey: 'tour.steps.welcome.title',
    bodyKey: 'tour.steps.welcome.body',
  },
  {
    id: 'visit',
    icon: Plus,
    titleKey: 'tour.steps.visit.title',
    bodyKey: 'tour.steps.visit.body',
    ctaKey: 'tour.steps.visit.cta',
    ctaPath: (id) => `/${id}/visits`,
  },
  {
    id: 'expense',
    icon: Receipt,
    titleKey: 'tour.steps.expense.title',
    bodyKey: 'tour.steps.expense.body',
    ctaKey: 'tour.steps.expense.cta',
    ctaPath: (id) => `/${id}/expenses`,
  },
  {
    id: 'retail',
    icon: Banknote,
    titleKey: 'tour.steps.retail.title',
    bodyKey: 'tour.steps.retail.body',
  },
  {
    id: 'calendar',
    icon: Calendar,
    titleKey: 'tour.steps.calendar.title',
    bodyKey: 'tour.steps.calendar.body',
  },
  {
    id: 'integrations',
    icon: Plug,
    titleKey: 'tour.steps.integrations.title',
    bodyKey: 'tour.steps.integrations.body',
    ctaKey: 'tour.steps.integrations.cta',
    ctaPath: (id) => `/${id}/settings?tab=integrations`,
  },
]

/**
 * Простой стартовый тур по приложению. Без highlight'ов конкретных
 * элементов (это потребовало бы portal+positioning, react-joyride или
 * аналог — не добавляем зависимости).
 *
 * Показывается раз в жизни юзера: после первого визита на dashboard,
 * если в localStorage нет finkley:tour:dismissed. Юзер может пропустить
 * целиком (Skip → запоминаем) или пройти по шагам.
 *
 * Для повторного запуска — кнопка «Показать тур» в /help (force=true через
 * ?showTour=1 query, см. HelpPage.relaunchTour). DashboardPage читает
 * query и пробрасывает force prop, что игнорирует dismissed-флаг.
 */
export function OnboardingTour({ salonId, force = false }: { salonId: string; force?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

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

  if (!open) return null

  const step = STEPS[stepIndex]!
  const Icon = step.icon
  const isLast = stepIndex === STEPS.length - 1
  const isFirst = stepIndex === 0

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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      <div className="bg-card shadow-finxl relative w-full max-w-md rounded-xl p-6 sm:p-7">
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground absolute right-4 top-4 grid size-7 place-items-center rounded-md"
          aria-label={t('tour.close')}
        >
          <X className="size-4" strokeWidth={1.7} />
        </button>

        {/* Progress dots */}
        <div className="mb-5 flex items-center gap-1.5">
          {STEPS.map((_, i) => (
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

        <div className="bg-brand-teal-soft text-brand-teal-deep mx-auto mb-4 grid size-14 place-items-center rounded-2xl">
          <Icon className="size-6" strokeWidth={1.7} />
        </div>

        <h2
          id="tour-title"
          className="text-brand-navy text-center text-xl font-bold tracking-tight"
        >
          {t(step.titleKey)}
        </h2>
        <p className="text-foreground/80 mt-3 whitespace-pre-line text-center text-sm leading-relaxed">
          {t(step.bodyKey)}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          {step.ctaKey && step.ctaPath ? (
            <Button type="button" size="lg" onClick={tryCta}>
              {t(step.ctaKey)}
            </Button>
          ) : null}
          <Button
            type="button"
            size="lg"
            variant={step.ctaKey ? 'outline' : 'primary'}
            onClick={next}
          >
            {isLast ? t('tour.finish') : t('tour.next')}
          </Button>
          {!isFirst && !isLast ? (
            <button
              type="button"
              onClick={() => setStepIndex((i) => i - 1)}
              className="text-muted-foreground hover:text-foreground text-sm font-medium"
            >
              {t('tour.back')}
            </button>
          ) : null}
          {!isLast ? (
            <button
              type="button"
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              {t('tour.skip')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
