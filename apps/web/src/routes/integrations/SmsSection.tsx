import {
  Check,
  CreditCard,
  Info,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  ShoppingCart,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SMS_PACKAGES,
  SMS_SENDER_PRICE_GROSZ,
  useBuySmsPackage,
  useBuySmsSender,
  useCancelSmsSender,
  useSetActiveSender,
  useSmsPurchases,
  useSmsSalonStatus,
  useSmsSenders,
  useToggleSmsPaused,
} from '@/hooks/useSms'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Settings → Интеграции → SMS.
 * - Баланс SMS + owner pause toggle
 * - Активный sender (FINKLEY / приватные)
 * - Покупка пакетов (6 вариантов) через Stripe
 * - Покупка приватного sender name (100 zł) через Stripe + SMSAPI
 * - История покупок
 */
export function SmsSection({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const status = useSmsSalonStatus(salonId)
  const senders = useSmsSenders(salonId)
  const purchases = useSmsPurchases(salonId)
  const togglePaused = useToggleSmsPaused(salonId)
  const setActiveSender = useSetActiveSender(salonId)
  const buyPackage = useBuySmsPackage(salonId)
  const buySender = useBuySmsSender(salonId)
  const cancelSender = useCancelSmsSender(salonId)

  const [newSenderName, setNewSenderName] = useState('')

  // Stripe возвращает на ?stripe=success/cancel — показываем toast и чистим.
  useEffect(() => {
    const sp = params.get('stripe')
    if (sp === 'success') {
      toast.success(t('integrations.sms.toast_stripe_success'))
      const next = new URLSearchParams(params)
      next.delete('stripe')
      setParams(next, { replace: true })
    } else if (sp === 'cancel') {
      toast.info(t('integrations.sms.toast_stripe_cancel'))
      const next = new URLSearchParams(params)
      next.delete('stripe')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('stripe')])

  const balance = status.data?.sms_balance ?? 0
  const paused = status.data?.sms_paused ?? false
  const activeSenderId = status.data?.sms_active_sender_id ?? null
  const activeSenders = (senders.data ?? []).filter((s) => s.status === 'active')
  const pendingSenders = (senders.data ?? []).filter(
    (s) => s.status === 'pending_smsapi' || s.status === 'pending_payment',
  )

  function handleBuyPackage(size: number) {
    buyPackage.mutate(size, {
      onSuccess: ({ url }) => {
        window.location.href = url
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    })
  }

  function handleBuySender() {
    const name = newSenderName.trim()
    if (!name) {
      toast.error(t('integrations.sms.sender_name_required'))
      return
    }
    buySender.mutate(name, {
      onSuccess: ({ url }) => {
        window.location.href = url
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('invalid_sender_name')) {
          toast.error(t('integrations.sms.sender_name_invalid'))
        } else if (msg.includes('sender_already_purchased')) {
          toast.error(t('integrations.sms.sender_name_dup'))
        } else {
          toast.error(msg)
        }
      },
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ----------------- Баланс + Pause ----------------- */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-brand-navy text-base font-bold tracking-tight">
              {t('integrations.sms.balance_title')}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('integrations.sms.balance_subtitle')}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                'num text-3xl font-bold tracking-tight',
                balance <= 2 ? 'text-destructive' : 'text-brand-sage-deep',
              )}
            >
              {balance}
            </p>
            <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              {t('integrations.sms.balance_unit')}
            </p>
          </div>
        </div>

        {balance <= 2 ? (
          <p className="bg-destructive/10 text-destructive mt-3 rounded-md p-2.5 text-xs">
            {balance === 0
              ? t('integrations.sms.balance_empty_warn')
              : t('integrations.sms.balance_low_warn', { count: balance })}
          </p>
        ) : null}

        <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-4">
          <div className="flex items-center gap-2">
            {paused ? (
              <Pause className="text-destructive size-4" strokeWidth={2} />
            ) : (
              <Play className="text-brand-sage size-4" strokeWidth={2} />
            )}
            <div>
              <Label htmlFor="sms-paused" className="text-sm font-semibold">
                {t('integrations.sms.pause_label')}
              </Label>
              <p className="text-muted-foreground text-[11px]">
                {t('integrations.sms.pause_hint')}
              </p>
            </div>
          </div>
          <button
            id="sms-paused"
            type="button"
            role="switch"
            aria-checked={paused}
            onClick={() => togglePaused.mutate(!paused)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
              paused ? 'bg-destructive' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'inline-block size-5 transform rounded-full bg-white shadow ring-0 transition-transform',
                paused ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </section>

      {/* ----------------- Активный sender ----------------- */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold tracking-tight">
          {t('integrations.sms.sender_title')}
        </h3>
        <p className="text-muted-foreground mb-3 mt-1 text-xs">
          {t('integrations.sms.sender_subtitle')}
        </p>

        <div className="flex flex-col gap-2">
          <SenderOption
            label="FINKLEY"
            sub={t('integrations.sms.sender_finkley_hint')}
            active={activeSenderId === null}
            onClick={() => setActiveSender.mutate(null)}
            free
          />
          {activeSenders.map((s) => (
            <SenderOption
              key={s.id}
              label={s.sender_name}
              sub={t('integrations.sms.sender_active_hint')}
              active={activeSenderId === s.id}
              onClick={() => setActiveSender.mutate(s.id)}
            />
          ))}
          {pendingSenders.map((s) => {
            const ageMs = Date.now() - new Date(s.created_at).getTime()
            const ageMin = Math.floor(ageMs / 60_000)
            const isStale = ageMin >= 5 && s.status === 'pending_payment'
            return (
              <div
                key={s.id}
                className="border-border/40 bg-muted/20 flex flex-wrap items-start gap-3 rounded-md border p-3"
              >
                <Loader2 className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-semibold">{s.sender_name}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {s.status === 'pending_payment'
                      ? t('integrations.sms.sender_pending_payment')
                      : t('integrations.sms.sender_pending_smsapi')}
                    {isStale ? (
                      <span className="text-muted-foreground/70 ml-1">
                        · {t('integrations.sms.sender_age_min', { count: ageMin })}
                      </span>
                    ) : null}
                  </p>
                </div>
                {s.status === 'pending_payment' ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {s.stripe_checkout_url ? (
                      <a
                        href={s.stripe_checkout_url}
                        className="bg-brand-navy hover:bg-brand-navy/90 inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold text-white"
                      >
                        <CreditCard className="size-3" strokeWidth={2.2} />
                        {t('integrations.sms.sender_pay_now')}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => cancelSender.mutate(s.id)}
                      disabled={cancelSender.isPending}
                      className="text-destructive hover:bg-destructive/10 rounded px-2 py-1 text-[11px] font-semibold"
                    >
                      {t('integrations.sms.sender_cancel')}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {/* ----------------- Купить sender ----------------- */}
      <section className="border-brand-gold-soft bg-brand-gold-soft/20 rounded-lg border p-5">
        <h3 className="text-brand-navy flex items-center gap-2 text-base font-bold tracking-tight">
          <MessageSquare className="size-4" strokeWidth={2} />
          {t('integrations.sms.buy_sender_title')}
        </h3>
        <p className="text-muted-foreground mb-3 mt-1 text-xs">
          {t('integrations.sms.buy_sender_subtitle', {
            price: formatCurrency(SMS_SENDER_PRICE_GROSZ, 'PLN'),
          })}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={newSenderName}
            onChange={(e) => setNewSenderName(e.target.value)}
            placeholder={t('integrations.sms.sender_name_placeholder')}
            maxLength={11}
            className="font-mono"
          />
          <Button onClick={handleBuySender} disabled={buySender.isPending}>
            {buySender.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShoppingCart className="size-4" strokeWidth={2} />
            )}
            {t('integrations.sms.buy_sender_button', {
              price: formatCurrency(SMS_SENDER_PRICE_GROSZ, 'PLN'),
            })}
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-[10.5px]">
          {t('integrations.sms.sender_rules_hint')}
        </p>
      </section>

      {/* ----------------- Купить пакет SMS ----------------- */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold tracking-tight">
          {t('integrations.sms.packages_title')}
        </h3>
        <p className="text-muted-foreground mb-4 mt-1 text-xs">
          {t('integrations.sms.packages_subtitle')}
        </p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {SMS_PACKAGES.map((p) => {
            const total = p.size * p.pricePerSmsGrosz
            return (
              <button
                key={p.size}
                type="button"
                onClick={() => handleBuyPackage(p.size)}
                disabled={buyPackage.isPending}
                className="border-border bg-card hover:border-brand-sage hover:bg-brand-sage-soft/20 flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors disabled:opacity-50"
              >
                <p className="num text-brand-navy text-xl font-bold">{p.size}</p>
                <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                  {t('integrations.sms.balance_unit')}
                </p>
                <p className="text-brand-sage-deep num mt-1 text-sm font-bold">
                  {formatCurrency(total, 'PLN')}
                </p>
                <p className="text-muted-foreground num text-[10.5px]">
                  {(p.pricePerSmsGrosz / 100).toFixed(2)} zł / SMS
                </p>
              </button>
            )
          })}
        </div>
      </section>

      {/* ----------------- История ----------------- */}
      {(purchases.data ?? []).length > 0 ? (
        <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
          <h3 className="text-brand-navy text-base font-bold tracking-tight">
            {t('integrations.sms.history_title')}
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-muted-foreground border-b text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">
                    {t('integrations.sms.history_date')}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {t('integrations.sms.history_size')}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {t('integrations.sms.history_price')}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {t('integrations.sms.history_status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(purchases.data ?? []).map((p) => (
                  <tr key={p.id} className="border-border/40 border-t">
                    <td className="px-2 py-2 text-xs">
                      {new Date(p.paid_at ?? p.created_at).toLocaleDateString()}
                    </td>
                    <td className="num px-2 py-2 text-right text-sm font-semibold">
                      {p.package_size}
                    </td>
                    <td className="num px-2 py-2 text-right text-sm">
                      {formatCurrency(p.total_grosz, 'PLN')}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px]">
                      {p.status === 'paid' ? (
                        <span className="text-brand-sage-deep inline-flex items-center gap-1 font-semibold">
                          <Check className="size-3" strokeWidth={2.4} />
                          {t('integrations.sms.history_paid')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t(`integrations.sms.history_${p.status}`)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* ----------------- Info footer ----------------- */}
      <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
        <Info className="mt-0.5 size-3 shrink-0" strokeWidth={2} />
        {t('integrations.sms.info_footer')}
      </p>
    </div>
  )
}

function SenderOption({
  label,
  sub,
  active,
  onClick,
  free,
}: {
  label: string
  sub: string
  active: boolean
  onClick: () => void
  free?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-md border p-3 text-left transition-colors',
        active
          ? 'border-brand-sage bg-brand-sage-soft/30'
          : 'border-border bg-card hover:border-brand-sage/40',
      )}
    >
      <div
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
          active ? 'border-brand-sage bg-brand-sage' : 'border-muted-foreground/30',
        )}
      >
        {active ? <Check className="size-3 text-white" strokeWidth={2.6} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-bold">
          {label}
          {free ? (
            <span className="text-brand-sage-deep ml-2 text-[10px] font-semibold uppercase">
              free
            </span>
          ) : null}
        </p>
        <p className="text-muted-foreground text-[11px]">{sub}</p>
      </div>
    </button>
  )
}
