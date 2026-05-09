import { ExternalLink, MessageCircle, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { LogoLockup } from '@/components/ui/logo'

import { HelpFAQ } from './HelpFAQ'

export function HelpPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()

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
