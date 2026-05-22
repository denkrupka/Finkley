import { format, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { getDateLocale } from '@/lib/utils/format-date'
import { useClients } from '@/hooks/useClients'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import type { VisitRow } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatPhoneDisplay } from '@/lib/utils/format-phone'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  visit: VisitRow | null
}

/**
 * Квитанция визита в стиле fiscal-receipt. Структура (по примеру #62):
 *   1. Статус-pill + дата справа
 *   2. Заголовок: «Квитанция №ID» / клиент / название салона
 *   3. Таблица позиций: Позиция | Кол-во | Сумма
 *   4. Раздел сумм: Сумма / Чаевые / Скидка / Итого (bold)
 *   5. Строка оплаты с методом и временем
 *   6. Зубчатый низ (как у бумажного чека)
 *
 * Не fiscal-чек — это человекочитаемое подтверждение для клиента (скриншот /
 * AirDrop).
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
  const dateLabel = format(at, 'd MMMM yyyy', { locale: getDateLocale() })
  const timeLabel = format(at, 'HH:mm')
  const gross = visit.amount_cents
  const tip = visit.tip_cents
  const discount = visit.discount_cents
  const total = gross - discount + tip
  const paidAtLabel = visit.updated_at
    ? format(parseISO(visit.updated_at), 'dd.MM.yyyy, HH:mm', { locale: getDateLocale() })
    : `${format(at, 'dd.MM.yyyy', { locale: getDateLocale() })}, ${timeLabel}`

  const methodLabel = visit.payment_method
    ? t(`payment_methods.${visit.payment_method}`, { defaultValue: visit.payment_method })
    : '—'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[min(560px,95vw)] gap-0 overflow-visible bg-transparent p-0 shadow-none">
        {/* Бумажная карточка с зубчатым низом */}
        <div
          className="bg-white px-6 pb-6 pt-5"
          style={{
            WebkitMaskImage:
              'radial-gradient(circle 8px at 8px 100%, transparent 7.5px, black 8px) repeat-x',
            WebkitMaskSize: '16px 16px',
            WebkitMaskPosition: 'bottom',
            maskImage:
              'radial-gradient(circle 8px at 8px 100%, transparent 7.5px, black 8px) repeat-x',
            maskSize: '16px 16px',
            maskPosition: 'bottom',
            paddingBottom: 22,
          }}
        >
          {/* 1. Статус + дата. pr-12 — чтобы дата не залезла под крестик закрытия модалки. */}
          <div className="mb-3 flex items-start justify-between pr-12">
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              {t('visits.receipt.paid')}
            </span>
            <p className="text-muted-foreground whitespace-nowrap text-xs">{dateLabel}</p>
          </div>

          {/* 2. Заголовок */}
          <div className="mb-4">
            <h2 className="text-foreground text-lg font-bold tracking-tight">
              {t('visits.receipt.title', { id: visit.id.slice(0, 8).toUpperCase() })}
            </h2>
            {client ? (
              <p className="text-foreground mt-0.5 text-sm">
                {client.name}
                {client.phone ? (
                  <span className="num text-muted-foreground">
                    {' · '}
                    {formatPhoneDisplay(client.phone)}
                  </span>
                ) : null}
                {client.email ? (
                  <span className="text-muted-foreground">
                    {' · '}
                    {client.email}
                  </span>
                ) : null}
              </p>
            ) : null}
            <p className="text-foreground mt-2 text-sm font-bold">{salon?.name ?? '—'}</p>
          </div>

          {/* 3. Таблица позиций */}
          <div className="border-border border-t pt-3">
            <div className="text-muted-foreground mb-2 grid grid-cols-[1fr_auto] gap-x-4 text-[10px] font-bold uppercase tracking-wider">
              <span>{t('visits.receipt.position')}</span>
              <span className="text-right">{t('visits.receipt.amount')}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-4">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-semibold">
                  {visit.service_name_snapshot ?? '—'}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {dateLabel} · {timeLabel}
                  {stf ? ` · ${stf.full_name}` : ''}
                </p>
                {visit.comment ? (
                  <p className="text-muted-foreground mt-1 text-xs italic">«{visit.comment}»</p>
                ) : null}
              </div>
              <p className="num text-foreground self-start text-right text-sm font-bold tabular-nums">
                {formatCurrency(gross, currency)}
              </p>
            </div>
          </div>

          {/* 4. Суммы */}
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

          {/* 5. Оплачено · метод · время → сумма */}
          <div className="border-border mt-3 flex items-center justify-between border-t pt-3 text-xs">
            <span className="text-muted-foreground">
              {t('visits.receipt.paid_at', { method: methodLabel, at: paidAtLabel })}
            </span>
            <span className="num text-foreground font-bold tabular-nums">
              {formatCurrency(total, currency)}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
