import {
  ExternalLink,
  MessageCircle,
  PiggyBank,
  PlayCircle,
  Package,
  Receipt,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { LogoLockup } from '@/components/ui/logo'

import { HelpFAQ } from './HelpFAQ'

type TourCard = {
  id: 'onboarding' | 'expenses' | 'finance' | 'inventory'
  icon: LucideIcon
  storageKey: string
  /** Куда вести при клике (без leading /salonId). */
  pathBuilder: (salonId: string) => string
  titleKey: string
  bodyKey: string
}

const TOURS: TourCard[] = [
  {
    id: 'onboarding',
    icon: Sparkles,
    storageKey: 'finkley:tour:dismissed',
    pathBuilder: (s) => `/${s}/dashboard?showTour=1`,
    titleKey: 'help.tours.onboarding.title',
    bodyKey: 'help.tours.onboarding.body',
  },
  {
    id: 'expenses',
    icon: Receipt,
    storageKey: 'finkley:tour:page:expenses',
    pathBuilder: (s) => `/${s}/expenses?tour=1`,
    titleKey: 'help.tours.expenses.title',
    bodyKey: 'help.tours.expenses.body',
  },
  {
    id: 'finance',
    icon: PiggyBank,
    storageKey: 'finkley:tour:page:finance',
    pathBuilder: (s) => `/${s}/finance?tour=1`,
    titleKey: 'help.tours.finance.title',
    bodyKey: 'help.tours.finance.body',
  },
  {
    id: 'inventory',
    icon: Package,
    storageKey: 'finkley:tour:page:inventory',
    pathBuilder: (s) => `/${s}/inventory?tour=1`,
    titleKey: 'help.tours.inventory.title',
    bodyKey: 'help.tours.inventory.body',
  },
]

export function HelpPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const navigate = useNavigate()

  function relaunchTour(tour: TourCard) {
    if (!salonId) return
    // Сбрасываем dismissed-флаг + прокидываем query (force=true) для надёжности
    // — query сработает даже если localStorage недоступен.
    try {
      localStorage.removeItem(tour.storageKey)
    } catch {
      // ignore
    }
    navigate(tour.pathBuilder(salonId))
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="border-border bg-card border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to={salonId ? `/${salonId}/dashboard` : '/'} aria-label="back">
            <LogoLockup size={24} />
          </Link>
          <a
            href="mailto:support@finkley.app"
            className="text-secondary inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            <MessageCircle className="size-4" strokeWidth={1.7} />
            {t('help.contact_support')}
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8 flex items-center gap-3">
          <span
            className="bg-brand-teal-soft text-brand-teal-deep grid size-12 place-items-center rounded-xl"
            aria-hidden
          >
            <Sparkles className="size-5" strokeWidth={1.8} />
          </span>
          <div>
            <h1 className="text-brand-navy text-3xl font-bold tracking-tight">{t('help.title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('help.subtitle')}</p>
          </div>
        </div>

        {salonId ? (
          <section className="mb-8">
            <h2 className="text-brand-navy mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
              <PlayCircle className="text-secondary size-4" strokeWidth={1.8} />
              {t('help.tours.section_title', { defaultValue: 'Гиды и обучение' })}
            </h2>
            <p className="text-muted-foreground mb-4 text-sm">
              {t('help.tours.section_subtitle', {
                defaultValue:
                  'Короткие туры по ключевым разделам. Можно запустить заново когда нужно — снова покажет подсветку и пояснения.',
              })}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TOURS.map((tour) => {
                const Icon = tour.icon
                return (
                  <button
                    key={tour.id}
                    type="button"
                    onClick={() => relaunchTour(tour)}
                    className="border-border bg-card hover:border-secondary/40 hover:bg-muted/20 group flex items-start gap-3 rounded-lg border p-4 text-left transition-colors"
                  >
                    <span
                      className="bg-brand-teal-soft text-brand-teal-deep grid size-10 shrink-0 place-items-center rounded-lg"
                      aria-hidden
                    >
                      <Icon className="size-5" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-brand-navy text-sm font-bold">{t(tour.titleKey)}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                        {t(tour.bodyKey)}
                      </p>
                      <span className="text-secondary mt-2 inline-flex items-center gap-1 text-xs font-semibold group-hover:underline">
                        {t('help.tours.relaunch', { defaultValue: 'Показать ещё раз →' })}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        <HelpFAQ />

        <div className="border-secondary/30 bg-secondary/5 mt-8 rounded-lg border p-5">
          <h2 className="text-brand-navy text-lg font-bold">{t('help.still_stuck')}</h2>
          <p className="text-foreground/80 mt-1.5 text-sm leading-snug">
            {t('help.still_stuck_body')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="mailto:support@finkley.app"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors"
            >
              <MessageCircle className="size-4" strokeWidth={1.8} />
              support@finkley.app
            </a>
            <a
              href="https://t.me/finklay_dev_bot"
              target="_blank"
              rel="noreferrer"
              className="border-border bg-card hover:bg-muted/40 inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors"
            >
              {t('help.telegram_bug')}
              <ExternalLink className="size-3.5" strokeWidth={1.7} />
            </a>
          </div>
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          {t('help.footer')}{' '}
          <a href="/privacy" className="hover:underline">
            Privacy
          </a>{' '}
          ·{' '}
          <a href="/terms" className="hover:underline">
            Terms
          </a>
        </p>
      </main>
    </div>
  )
}
