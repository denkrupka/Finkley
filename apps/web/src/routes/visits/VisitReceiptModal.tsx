import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useClients } from '@/hooks/useClients'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import type { VisitRow } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  visit: VisitRow | null
}

/**
 * Визуализация подтверждения оплаты визита в виде квитанции (а-ля Booksy
 * receipt). Открывается в QuickEntryModal в edit-mode когда status='paid'
 * вместо кнопки «Рассчитать». Это не настоящий fiscal-чек — только
 * человекочитаемая выдержка из визита (для скриншота / отправки клиенту).
 */
export function VisitReceiptModal({ open, onClose, salonId, visit }: Props) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const { data: staff = [] } = useStaff(salonId)
  const { data: clients = [] } = useClients(salonId)

  if (!visit) return null
  const currency = salon?.currency ?? 'PLN'
  const client = visit.client_id ? clients.find((c) => c.id === visit.client_id) : null
  const stf = visit.staff_id ? staff.find((s) => s.id === visit.staff_id) : null

  const at = parseISO(visit.visit_at)
  const dateLabel = format(at, 'd MMMM yyyy', { locale: ru })
  const timeLabel = format(at, 'HH:mm')
  const gross = visit.amount_cents
  const tip = visit.tip_cents
  const discount = visit.discount_cents
  const total = gross - discount + tip

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[min(560px,95vw)] gap-0 p-0">
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="bg-brand-sage-soft text-brand-sage-deep border-current/30 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
              {t('visits.receipt.paid')}
            </span>
            <p className="text-muted-foreground text-xs">{dateLabel}</p>
          </div>

          <div className="mb-4">
            <h2 className="text-brand-navy text-lg font-bold tracking-tight">
              {t('visits.receipt.title', { id: visit.id.slice(0, 8).toUpperCase() })}
            </h2>
            {client ? (
              <p className="text-foreground mt-0.5 text-sm">
                {client.name}
                {client.phone ? (
                  <span className="text-muted-foreground"> · {client.phone}</span>
                ) : null}
              </p>
            ) : null}
            <p className="text-foreground mt-2 text-sm font-semibold">{salon?.name ?? '—'}</p>
          </div>

          <div className="border-border border-t pt-3">
            <div className="text-muted-foreground mb-2 flex justify-between text-[11px] font-bold uppercase tracking-wider">
              <span>{t('visits.receipt.position')}</span>
              <span>{t('visits.receipt.amount')}</span>
            </div>
            <div className="flex justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  {visit.service_name_snapshot ?? '—'}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {dateLabel} · {timeLabel}
                  {stf ? ` · ${stf.full_name}` : ''}
                </p>
                {visit.comment ? (
                  <p className="text-muted-foreground mt-1 text-xs italic">{visit.comment}</p>
                ) : null}
              </div>
              <p className="num text-foreground shrink-0 text-sm font-bold tabular-nums">
                {formatCurrency(gross, currency)}
              </p>
            </div>
          </div>

          <div className="border-border mt-4 space-y-1 border-t pt-3 text-sm">
            <div className="text-muted-foreground flex justify-between">
              <span>{t('visits.receipt.subtotal')}</span>
              <span className="num tabular-nums">{formatCurrency(gross, currency)}</span>
            </div>
            {tip > 0 ? (
              <div className="text-muted-foreground flex justify-between">
                <span>{t('visits.receipt.tip')}</span>
                <span className="num tabular-nums">+{formatCurrency(tip, currency)}</span>
              </div>
            ) : null}
            {discount > 0 ? (
              <div className="text-muted-foreground flex justify-between">
                <span>{t('visits.receipt.discount')}</span>
                <span className="num tabular-nums">−{formatCurrency(discount, currency)}</span>
              </div>
            ) : null}
            <div className="text-foreground border-border mt-2 flex justify-between border-t pt-2 text-base font-bold">
              <span>{t('visits.receipt.total')}</span>
              <span className="num tabular-nums">{formatCurrency(total, currency)}</span>
            </div>
          </div>

          <div className="border-border mt-4 border-t pt-3 text-xs">
            <p className="text-muted-foreground">
              {t('visits.receipt.payment', {
                method: visit.payment_method
                  ? t(`payment_methods.${visit.payment_method}`, {
                      defaultValue: visit.payment_method,
                    })
                  : '—',
              })}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
