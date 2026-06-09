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
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useSalonMembership } from '@/hooks/useSalons'

import { TourStage } from './TourStage'

const STORAGE_KEY = 'finkley:tour:dismissed'
// T147 — сохраняем индекс шага. При возврате на /dashboard тур не начинается
// сначала, а продолжает с того места где юзер был.
const STORAGE_STEP_KEY = 'finkley:tour:step'

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
    // Bug (баг-трекер): шаг вёл на /reports — для роли staff раздел запрещён
    // (RequirePermission → toast «Нет доступа» + чёрный фон оверлея на редиректе).
    // Календарь визитов живёт во вкладке «Визиты» (доступна и мастеру), туда и ведём.
    target: '[data-tour-nav="income"]',
    navigatePath: '/income?tab=visits',
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
 * Spotlight реализован через overlay с 4-мя затемняющими div'ами —
 * нет react-joyride зависимости. Общий рендерер в `./TourStage` —
 * тот же используется в `PageTour` (T214) чтобы локальные туры выглядели
 * идентично главному: spotlight cutout + tooltip рядом с таргетом,
 * а не центрированная модалка.
 *
 * Показывается раз в жизни юзера (localStorage). Повторный запуск — через
 * /help → «Показать тур» (?showTour=1 в query).
 */
export function OnboardingTour({ salonId, force = false }: { salonId: string; force?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: membership } = useSalonMembership(salonId)
  // Bug (баг-трекер): раньше тут было `?? 'owner'` — пока membership грузился,
  // мастеру показывались owner-шаги и тур уводил его в owner-разделы → «Нет
  // доступа». Теперь ждём загрузку роли (roleReady) и до неё показываем только
  // общие шаги (без roles).
  const role = membership?.role as 'owner' | 'admin' | 'staff' | 'accountant' | undefined
  const roleReady = membership !== undefined
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndexState] = useState(0)

  // Фильтруем шаги по роли текущего юзера.
  const steps = STEPS.filter((s) => !s.roles || (role ? s.roles.includes(role) : false))

  // T147 — wrapper для setStepIndex который persist'ит index в localStorage.
  function setStepIndex(value: number | ((prev: number) => number)) {
    setStepIndexState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      try {
        localStorage.setItem(STORAGE_STEP_KEY, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  useEffect(() => {
    if (force) {
      setOpen(true)
      setStepIndexState(0)
      try {
        localStorage.removeItem(STORAGE_STEP_KEY)
      } catch {
        /* ignore */
      }
      return
    }
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY) === '1'
      if (!dismissed) {
        // T147 — продолжаем с сохранённого step'а (если есть)
        const savedStep = Number(localStorage.getItem(STORAGE_STEP_KEY) ?? '0')
        if (Number.isFinite(savedStep) && savedStep > 0) {
          setStepIndexState(Math.min(savedStep, steps.length - 1))
        }
        setOpen(true)
      }
    } catch {
      // localStorage недоступен (SSR / private mode) — не показываем
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force])

  function dismiss(opts?: { navigateHome?: boolean }) {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
      localStorage.removeItem(STORAGE_STEP_KEY)
    } catch {
      // ignore
    }
    setOpen(false)
    // В конце тура — на дашборд, чтобы запустился локальный PageTour
    // дашборда (он ждёт MAIN_TOUR_KEY=1, теперь это true).
    if (opts?.navigateHome && salonId) navigate(`/${salonId}/dashboard`)
  }

  const step = steps[Math.min(stepIndex, steps.length - 1)]!
  const isLast = stepIndex >= steps.length - 1
  const isFirst = stepIndex === 0

  // T127 — auto-navigate перед measure target. Каждый шаг может иметь
  // navigatePath; если он отличается от текущего pathname — навигируем
  // туда. useTargetRect перемеряет каждые 800ms и сам поймает элемент
  // после нового рендера страницы.
  useEffect(() => {
    if (!open || !roleReady || !step.navigatePath) return
    const full = `/${salonId}${step.navigatePath}`
    const current = window.location.pathname + window.location.search
    const fullPath = full.split('?')[0]!
    if (current.startsWith(fullPath)) return
    navigate(full)
  }, [open, roleReady, stepIndex, step.navigatePath, salonId, navigate])

  if (!open || !roleReady) return null

  function next() {
    // Финиш тура → редирект на дашборд (там запустится локальный PageTour).
    if (isLast) dismiss({ navigateHome: true })
    else setStepIndex((i) => i + 1)
  }

  function tryCta() {
    if (step.ctaPath) {
      dismiss()
      navigate(step.ctaPath(salonId))
    }
  }

  return (
    <TourStage
      step={step}
      steps={steps}
      stepIndex={stepIndex}
      isFirst={isFirst}
      isLast={isLast}
      onNext={next}
      onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
      onSkip={() => dismiss()}
      onCta={tryCta}
      t={t}
    />
  )
}
