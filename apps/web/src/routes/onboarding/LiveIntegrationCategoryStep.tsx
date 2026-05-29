import { Check, ChevronRight, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessengerIntegrations } from '@/hooks/useMessenger'
import { useSalonIntegrations } from '@/hooks/useIntegrations'
import { useTgSessions } from '@/hooks/useTgUserbot'
import { cn } from '@/lib/utils/cn'
import { brandColor, isFullColorBrand } from './BrandIcon'
import { BankingConnectDialog } from '@/routes/integrations/BankingConnectDialog'
import { BooksyConnectDialog } from '@/routes/integrations/BooksyConnectDialog'
import { ConnectIntegrationDialog as SettingsConnectDialog } from '@/routes/integrations/ConnectIntegrationDialog'
import { INTEGRATIONS as INTEGRATIONS_REGISTRY } from '@/routes/integrations/integrations-config'
import { KsefConnectDialog } from '@/routes/integrations/KsefConnectDialog'
import { MessengerConnectDialog } from '@/routes/integrations/MessengerConnectDialog'
import { TelegramUserbotConnectDialog } from '@/routes/integrations/TelegramUserbotConnectDialog'
import { WfirmaConnectDialog } from '@/routes/integrations/WfirmaConnectDialog'

import type { OnboardingIntegration } from './OnboardingPage'

export type LiveIntegrationItem = {
  id: OnboardingIntegration
  icon: LucideIcon
  title: string
  benefit: string
}

type MessengerChannel = 'instagram' | 'facebook' | 'whatsapp'

/**
 * Live версия IntegrationCategoryStep — рендерит карточки интеграций и
 * открывает РЕАЛЬНЫЕ диалоги подключения (Booksy/Banking/Telegram/Meta
 * OAuth) — каждая карточка ведёт юзера через настоящий flow и после
 * успешного подключения показывает badge «Подключено».
 *
 * Требует salonId (early-created в OnboardingPage после Step "salon").
 * Если салона ещё нет — пусть OnboardingPage использует старый
 * IntegrationCategoryStep (collect credentials, apply на submit).
 */
export function LiveIntegrationCategoryStep({
  title,
  items,
  salonId,
}: {
  title: string
  items: LiveIntegrationItem[]
  salonId: string
}) {
  const { t } = useTranslation()
  const { data: connected = [] } = useSalonIntegrations(salonId)
  const { data: messengers = [] } = useMessengerIntegrations(salonId)
  const { data: tgSessions = [] } = useTgSessions(salonId)

  const [booksyOpen, setBooksyOpen] = useState(false)
  const [wfirmaOpen, setWfirmaOpen] = useState(false)
  const [ksefOpen, setKsefOpen] = useState(false)
  const [bankingOpen, setBankingOpen] = useState(false)
  const [tgUserbotOpen, setTgUserbotOpen] = useState(false)
  const [messengerOpen, setMessengerOpen] = useState<MessengerChannel | null>(null)
  const [settingsConnectOpen, setSettingsConnectOpen] = useState<OnboardingIntegration | null>(null)

  function isConnected(id: OnboardingIntegration): boolean {
    if (id === 'telegram') {
      return tgSessions.some((s) => s.status === 'active')
    }
    if (id === 'instagram' || id === 'facebook' || id === 'whatsapp') {
      const m = messengers.find((mi) => mi.channel === id)
      return !!m && m.status === 'connected'
    }
    if (id === 'booksy' || id === 'wfirma' || id === 'banking' || id === 'ksef') {
      const c = connected.find((ci) => ci.provider === id)
      return !!c && c.status !== 'disconnected'
    }
    if (id === 'fakturownia' || id === 'ifirma' || id === 'infakt') {
      const c = connected.find((ci) => ci.provider === id)
      return !!c && c.status !== 'disconnected'
    }
    return false
  }

  function handleConnect(id: OnboardingIntegration) {
    switch (id) {
      case 'booksy':
        setBooksyOpen(true)
        return
      case 'wfirma':
        setWfirmaOpen(true)
        return
      case 'ksef':
        setKsefOpen(true)
        return
      case 'telegram':
        setTgUserbotOpen(true)
        return
      case 'instagram':
      case 'facebook':
      case 'whatsapp':
        setMessengerOpen(id)
        return
      case 'banking':
        setBankingOpen(true)
        return
      case 'fakturownia':
      case 'ifirma':
      case 'infakt': {
        // Эти провайдеры используют SettingsConnectDialog (api_token-based).
        setSettingsConnectOpen(id)
        return
      }
      case 'ical':
      case 'ocr_notebook':
        // iCal и OCR пока не имеют реального connect-flow в settings.
        return
    }
  }

  const settingsProviderDef =
    settingsConnectOpen != null
      ? (INTEGRATIONS_REGISTRY.find((p) => p.id === settingsConnectOpen) ?? null)
      : null

  return (
    <div className="space-y-3">
      <h2 className="text-brand-navy text-2xl font-bold tracking-tight">{title}</h2>

      <div className="grid gap-2">
        {items.map((it) => {
          const connected = isConnected(it.id)
          const Icon = it.icon
          return (
            <div
              key={it.id}
              className={cn(
                'flex items-start gap-3 rounded-xl border-2 p-3 transition-colors',
                connected
                  ? 'border-brand-sage bg-brand-sage-soft/30'
                  : 'border-border bg-card hover:border-brand-teal-deep/40',
              )}
            >
              <div
                className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg text-white"
                style={{
                  background: connected
                    ? '#16a34a'
                    : isFullColorBrand(it.id)
                      ? 'transparent'
                      : brandColor(it.id),
                }}
              >
                {connected ? (
                  <Check className="size-5" strokeWidth={2.4} />
                ) : isFullColorBrand(it.id) ? (
                  <Icon className="size-9" strokeWidth={1.8} />
                ) : (
                  <Icon className="size-5" strokeWidth={1.8} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-bold">{it.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{it.benefit}</p>
              </div>
              {connected ? (
                <span className="bg-brand-sage mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  <Check className="size-3" strokeWidth={2.5} />
                  {t('integrations.status.connected')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConnect(it.id)}
                  className="text-secondary hover:text-secondary/80 mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm font-bold"
                  data-testid={`onb-connect-${it.id}`}
                >
                  {t('onboarding.connect_now')}
                  <ChevronRight className="size-3.5" strokeWidth={2.4} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <BooksyConnectDialog
        open={booksyOpen}
        onClose={() => setBooksyOpen(false)}
        salonId={salonId}
      />
      <WfirmaConnectDialog
        open={wfirmaOpen}
        onClose={() => setWfirmaOpen(false)}
        salonId={salonId}
      />
      <KsefConnectDialog open={ksefOpen} onClose={() => setKsefOpen(false)} salonId={salonId} />
      <BankingConnectDialog
        open={bankingOpen}
        onClose={() => setBankingOpen(false)}
        salonId={salonId}
      />
      <TelegramUserbotConnectDialog
        open={tgUserbotOpen}
        salonId={salonId}
        onClose={() => setTgUserbotOpen(false)}
      />
      <MessengerConnectDialog
        open={messengerOpen !== null}
        channel={messengerOpen}
        salonId={salonId}
        onClose={() => setMessengerOpen(null)}
      />
      <SettingsConnectDialog
        provider={settingsProviderDef}
        onClose={() => setSettingsConnectOpen(null)}
        salonId={salonId}
      />
      <p className="text-muted-foreground mt-2 text-xs">
        <Loader2 className="mr-1 inline size-3" strokeWidth={2} aria-hidden />
        {t('onboarding.connect_loading_hint')}
      </p>
    </div>
  )
}
