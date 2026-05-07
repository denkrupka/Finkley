import { ArrowLeft, Check, ChevronRight, Lock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ConnectIntegrationDialog } from './ConnectIntegrationDialog'
import { INTEGRATIONS, type IntegrationDef } from './integrations-config'

/**
 * Список доступных интеграций. Сейчас визуал-only (TASK-27 visual scaffold):
 * статус всегда «не подключено», кнопка connect открывает модалку с полями,
 * сохранение пока вызывает toast «скоро будет». Реальный sync — TASK-28/29.
 */
export function IntegrationsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [connecting, setConnecting] = useState<IntegrationDef | null>(null)

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5">
        <Link
          to={`/${salonId}/settings`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" strokeWidth={1.7} />
          {t('integrations.back_to_settings')}
        </Link>
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('integrations.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('integrations.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {INTEGRATIONS.map((p) => (
          <IntegrationCard key={p.id} provider={p} onConnect={() => setConnecting(p)} />
        ))}
      </div>

      <p className="text-muted-foreground mt-6 text-xs">{t('integrations.privacy_note')}</p>

      <ConnectIntegrationDialog provider={connecting} onClose={() => setConnecting(null)} />
    </div>
  )
}

function IntegrationCard({
  provider,
  onConnect,
}: {
  provider: IntegrationDef
  onConnect: () => void
}) {
  const { t } = useTranslation()
  const Icon = provider.icon
  const isLocked = provider.status !== 'available' && provider.status !== 'in_research'

  return (
    <button
      type="button"
      onClick={isLocked ? undefined : onConnect}
      disabled={isLocked}
      className={[
        'border-border bg-card shadow-finsm flex flex-col gap-3 rounded-lg border p-5 text-left transition-colors',
        isLocked ? 'cursor-not-allowed opacity-60' : 'hover:border-secondary cursor-pointer',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid size-12 shrink-0 place-items-center rounded-md text-white"
          style={{ background: provider.brandColor }}
        >
          <Icon className="size-6" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-brand-navy text-base font-bold">{provider.name}</h2>
            <StatusPill status={provider.status} />
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">{provider.region}</p>
        </div>
      </div>
      <p className="text-foreground/80 text-sm leading-snug">{t(provider.description_key)}</p>
      <div className="mt-auto flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {isLocked ? null : t('integrations.not_connected')}
        </span>
        {isLocked ? (
          <Lock className="text-muted-foreground size-4" strokeWidth={1.7} />
        ) : (
          <span className="text-secondary inline-flex items-center gap-1 text-sm font-semibold">
            {t('integrations.connect')}
            <ChevronRight className="size-3.5" strokeWidth={2} />
          </span>
        )}
      </div>
    </button>
  )
}

function StatusPill({ status }: { status: IntegrationDef['status'] }) {
  const { t } = useTranslation()
  const map = {
    available: { label: 'integrations.status.available', cls: 'bg-emerald-100 text-emerald-700' },
    in_research: { label: 'integrations.status.in_research', cls: 'bg-amber-100 text-amber-800' },
    coming_soon: { label: 'integrations.status.coming_soon', cls: 'bg-slate-100 text-slate-600' },
  } as const
  const m = map[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${m.cls}`}
    >
      {status === 'available' ? <Check className="size-3" strokeWidth={2.5} /> : null}
      {t(m.label)}
    </span>
  )
}
