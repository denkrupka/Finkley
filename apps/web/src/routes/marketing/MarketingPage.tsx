import { Calendar, Info, Loader2, Mail, MessageSquare, Send, Sparkles, Star } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  BROADCAST_KINDS,
  useBroadcastPrefs,
  useUpdateBroadcastPref,
  type BroadcastKind,
} from '@/hooks/useBroadcastPrefs'
import { useSendBroadcastTest } from '@/hooks/useMarketing'
import { usePermissions } from '@/hooks/usePermissions'
import { cn } from '@/lib/utils/cn'

import { ComposeBroadcastTab } from './ComposeBroadcastTab'

type MarketingSubTab = 'broadcasts' | 'compose'

const MARKETING_TABS: PageTab<MarketingSubTab>[] = [
  { id: 'broadcasts', labelKey: 'marketing.tabs.broadcasts', icon: Mail },
  { id: 'compose', labelKey: 'marketing.tabs.compose', icon: Sparkles },
]

const KIND_META: Record<BroadcastKind, { icon: typeof Mail }> = {
  marketing: { icon: Star },
  visit_reminder: { icon: Calendar },
  review_request: { icon: MessageSquare },
}

/**
 * /:salonId/marketing — Маркетинг. Сейчас одна табa «Рассылки» с таблицей
 * типов рассылок и чекбоксами Email / SMS на каждый. Кнопка «i» открывает
 * модалку с объяснением как работает этот тип.
 *
 * Какие cron'ы шлют что:
 *   marketing       — будущие массовые акции (пока нет cron)
 *   visit_reminder  — client-overdue-push (09:00 UTC, ежедневно)
 *   review_request  — send-review-request (каждые 6 ч)
 */
export function MarketingPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [active, setActive] = useState<MarketingSubTab>('broadcasts')
  const [infoKind, setInfoKind] = useState<BroadcastKind | null>(null)
  const [testKind, setTestKind] = useState<BroadcastKind | null>(null)

  const prefs = useBroadcastPrefs(salonId)
  const update = useUpdateBroadcastPref(salonId)
  const { can } = usePermissions(salonId)
  // T36 — per-tab guard. permissions matrix имеет marketing.content/competitors/
  // reviews — здесь grouping не совпадает один-к-одному; пропускаем если у
  // юзера хоть какой-то marketing-view есть.
  const visibleTabs = MARKETING_TABS.filter(() => can('marketing'))

  if (!salonId) return null

  function toggle(kind: BroadcastKind, channel: 'email' | 'sms', enabled: boolean) {
    update.mutate(
      { kind, channel, enabled },
      {
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('marketing.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('marketing.subtitle')}</p>
      </header>

      <PageTabsNav tabs={visibleTabs} active={active} onChange={setActive} t={t} />

      {active === 'compose' ? (
        <div className="mt-4">
          <ComposeBroadcastTab salonId={salonId} />
        </div>
      ) : (
        <section className="border-border bg-card shadow-finsm mt-4 rounded-lg border">
          <div className="border-border/40 border-b p-4">
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('marketing.broadcasts.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('marketing.broadcasts.subtitle')}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/30 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">
                    {t('marketing.broadcasts.col_name')}
                  </th>
                  <th className="px-4 py-3 text-center font-semibold">
                    {t('marketing.broadcasts.col_email')}
                  </th>
                  <th className="px-4 py-3 text-center font-semibold">
                    {t('marketing.broadcasts.col_sms')}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">{/* info button */}</th>
                </tr>
              </thead>
              <tbody>
                {BROADCAST_KINDS.map((kind) => {
                  const Icon = KIND_META[kind].icon
                  const channelPrefs = prefs.data?.[kind] ?? { email: true, sms: true }
                  return (
                    <tr key={kind} className="border-border/40 border-t">
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <div className="bg-brand-sage-soft text-brand-sage-deep grid size-9 shrink-0 place-items-center rounded-md">
                            <Icon className="size-4" strokeWidth={2} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-foreground text-sm font-semibold">
                              {t(`marketing.broadcasts.kind.${kind}.title`)}
                            </p>
                            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                              {t(`marketing.broadcasts.kind.${kind}.short`)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <ChannelCheckbox
                          checked={channelPrefs.email}
                          onChange={(v) => toggle(kind, 'email', v)}
                          disabled={update.isPending}
                        />
                      </td>
                      <td className="px-4 py-4 text-center">
                        <ChannelCheckbox
                          checked={channelPrefs.sms}
                          onChange={(v) => toggle(kind, 'sms', v)}
                          disabled={update.isPending}
                        />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setTestKind(kind)}
                            className="text-muted-foreground hover:bg-muted/60 hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                          >
                            <Send className="size-3.5" strokeWidth={2} />
                            {t('marketing.broadcasts.test_button')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setInfoKind(kind)}
                            className="text-muted-foreground hover:bg-muted/60 hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                          >
                            <Info className="size-3.5" strokeWidth={2} />
                            {t('marketing.broadcasts.info_button')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="border-border/40 border-t p-4">
            <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
              <Info className="mt-0.5 size-3 shrink-0" strokeWidth={2} />
              {t('marketing.broadcasts.footer_hint')}
            </p>
          </div>
        </section>
      )}

      <Dialog open={infoKind !== null} onOpenChange={(open) => !open && setInfoKind(null)}>
        <DialogContent>
          {infoKind ? (
            <>
              <DialogHeader>
                <DialogTitle>{t(`marketing.broadcasts.kind.${infoKind}.title`)}</DialogTitle>
                <DialogDescription>
                  {t(`marketing.broadcasts.kind.${infoKind}.short`)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm leading-relaxed">
                <p className="text-foreground whitespace-pre-line">
                  {infoKind === 'visit_reminder' ? (
                    <Trans
                      i18nKey={`marketing.broadcasts.kind.${infoKind}.long`}
                      components={{
                        servicesLink: (
                          <Link
                            to={`/${salonId}/services`}
                            onClick={() => setInfoKind(null)}
                            className="text-brand-sage-deep font-semibold underline underline-offset-2"
                          />
                        ),
                      }}
                    />
                  ) : (
                    t(`marketing.broadcasts.kind.${infoKind}.long`)
                  )}
                </p>
              </div>
              {infoKind === 'marketing' ? (
                <div className="border-border bg-muted/10 flex justify-end gap-2 border-t px-5 py-4">
                  <Button
                    onClick={() => {
                      setInfoKind(null)
                      setActive('compose')
                    }}
                  >
                    <Sparkles className="mr-1.5 size-4" strokeWidth={2} />
                    {t('marketing.compose.run_button')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <TestSendDialog salonId={salonId} kind={testKind} onClose={() => setTestKind(null)} />
    </div>
  )
}

function TestSendDialog({
  salonId,
  kind,
  onClose,
}: {
  salonId: string
  kind: BroadcastKind | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [channel, setChannel] = useState<'sms' | 'email'>('sms')
  const [to, setTo] = useState('')
  const send = useSendBroadcastTest(salonId)

  function handleSend() {
    if (!kind) return
    if (!to.trim()) {
      toast.error(t('marketing.broadcasts.test_to_required'))
      return
    }
    send.mutate(
      { kind, channel, to: to.trim() },
      {
        onSuccess: () => {
          toast.success(t('marketing.broadcasts.test_sent'))
          setTo('')
          onClose()
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : String(e)
          toast.error(t('marketing.broadcasts.test_failed', { message: msg }))
        },
      },
    )
  }

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {kind ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('marketing.broadcasts.test_title')}</DialogTitle>
              <DialogDescription>
                {t('marketing.broadcasts.test_subtitle', {
                  kind: t(`marketing.broadcasts.kind.${kind}.title`),
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <Label className="mb-2 block text-sm font-semibold">
                  {t('marketing.broadcasts.test_channel_label')}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <ChannelRadio
                    icon={MessageSquare}
                    label="SMS"
                    active={channel === 'sms'}
                    onClick={() => {
                      setChannel('sms')
                      setTo('')
                    }}
                  />
                  <ChannelRadio
                    icon={Mail}
                    label="Email"
                    active={channel === 'email'}
                    onClick={() => {
                      setChannel('email')
                      setTo('')
                    }}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="test-to" className="mb-1.5 block text-sm font-semibold">
                  {channel === 'sms'
                    ? t('marketing.broadcasts.test_phone_label')
                    : t('marketing.broadcasts.test_email_label')}
                </Label>
                <Input
                  id="test-to"
                  type={channel === 'email' ? 'email' : 'tel'}
                  inputMode={channel === 'sms' ? 'tel' : 'email'}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder={channel === 'sms' ? '+48 123 456 789' : 'test@example.com'}
                  autoFocus
                />
                <p className="text-muted-foreground mt-1.5 text-[11px]">
                  {channel === 'sms'
                    ? t('marketing.broadcasts.test_sms_hint')
                    : t('marketing.broadcasts.test_email_hint')}
                </p>
              </div>
            </div>

            <div className="border-border flex justify-end gap-2 border-t px-5 py-4">
              <Button variant="outline" onClick={onClose} disabled={send.isPending}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSend} disabled={send.isPending}>
                {send.isPending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Send className="mr-1.5 size-4" strokeWidth={2} />
                )}
                {t('marketing.broadcasts.test_send_button')}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ChannelRadio({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Mail
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold transition-colors',
        active
          ? 'border-brand-sage bg-brand-sage-soft/30 text-brand-sage-deep'
          : 'border-border bg-card text-muted-foreground hover:border-brand-sage/40',
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
      {label}
    </button>
  )
}

function ChannelCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
        checked
          ? 'border-brand-sage bg-brand-sage text-white'
          : 'border-muted-foreground/40 bg-card hover:border-brand-sage/50',
        disabled && 'opacity-50',
      )}
    >
      {checked ? (
        <svg
          viewBox="0 0 20 20"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <path d="M4 10l4 4 8-8" />
        </svg>
      ) : null}
    </button>
  )
}
