import { format } from 'date-fns'
import {
  CheckCircle2,
  Clock,
  Edit2,
  FileText,
  Loader2,
  Plus,
  Receipt,
  SkipForward,
  Trash2,
  User,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { getDateLocale } from '@/lib/utils/format-date'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CashGateRequiredDialog } from '@/components/CashGateRequiredDialog'
import { useClients } from '@/hooks/useClients'
import { useCashRegisters } from '@/hooks/useCashRegisters'
import { useRequireCashShift } from '@/hooks/useCashShifts'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import {
  useCreateVisit,
  useDeleteVisit,
  useUpdateVisit,
  useVisits,
  visitsKeys,
  type PaymentMethod,
  type VisitRow,
} from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Booksy-style карточка визита.
 *
 * Открывается при клике по существующему визиту в календаре.
 * Структура:
 *   - Header: статус визита (Подтверждено / Оплачен / Ожидает), client
 *   - Tabs: Wizyta (услуги) / Informacje (комментарий)
 *   - Tab Wizyta: список услуг визита (или группы через group_key).
 *     По каждой услуге — Edit. Внизу «+ Добавить услугу» создаёт новый
 *     visit с тем же group_key/client/date.
 *   - Footer: «Рассчитать» (Розлич) если есть pending услуги, иначе
 *     «Закрыть».
 *
 * Клик «Рассчитать» — переключает на charge-view внутри той же модалки:
 *   Tip-presets (0, 5%, 10%, 20%, custom), метод оплаты из справочника,
 *   опц. сумма (auto = sum amounts), submit → status='paid' всем visits +
 *   диалог документа (Чек/Фактура/Пропустить).
 */
export function VisitDetailModal({
  visit,
  salonId,
  currency,
  onClose,
  initialView,
  onBackFromCharge,
}: {
  visit: VisitRow | null
  salonId: string
  currency: string
  onClose: () => void
  /** Image #87: при открытии из QuickEntry-edit «Рассчитать» сразу прыгаем в charge. */
  initialView?: 'detail' | 'charge' | 'document'
  /** Если задан — «← Назад» в ChargeView не возвращает в detail-view (старый
   *  вкладочный UI), а закрывает модалку и передаёт управление родителю.
   *  Родитель обычно открывает QuickEntryModal в edit-режиме для этого визита. */
  onBackFromCharge?: (visit: VisitRow) => void
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<'detail' | 'charge' | 'document'>(initialView ?? 'detail')
  const [gateOpen, setGateOpen] = useState(false)
  const [tab, setTab] = useState<'wizyta' | 'info'>('wizyta')
  const [editingLineId, setEditingLineId] = useState<string | null>(null)

  useEffect(() => {
    if (visit) {
      setView(initialView ?? 'detail')
      setTab('wizyta')
      setEditingLineId(null)
    }
  }, [visit, initialView])

  // Все связанные визиты (по group_key или только сам visit).
  // Используем useVisits с дневным диапазоном — он уже кешируется в react-query.
  const visitDate = useMemo(() => (visit ? new Date(visit.visit_at) : new Date()), [visit])
  const dayStart = useMemo(() => {
    const d = new Date(visitDate)
    d.setHours(0, 0, 0, 0)
    return d
  }, [visitDate])
  const dayEnd = useMemo(() => {
    const d = new Date(dayStart)
    d.setDate(d.getDate() + 1)
    return d
  }, [dayStart])
  const { data: dayVisits = [] } = useVisits(
    salonId,
    { start: dayStart.toISOString(), end: dayEnd.toISOString() },
    {},
  )

  const groupLines = useMemo(() => {
    if (!visit) return [] as VisitRow[]
    if (visit.group_key) {
      return dayVisits
        .filter((v) => v.group_key === visit.group_key)
        .sort((a, b) => new Date(a.visit_at).getTime() - new Date(b.visit_at).getTime())
    }
    return [visit]
  }, [visit, dayVisits])

  const { data: services = [] } = useServices(salonId)
  const { data: staff = [] } = useStaff(salonId)
  const { data: clients = [] } = useClients(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  const { data: cashRegisters = [] } = useCashRegisters(salonId)
  // Per-user касса: гейт на «Рассчитать». Проверяем ДО открытия ChargeView,
  // чтобы юзер сразу видел сообщение, а не вбивал суммы зря.
  const { hasOpenShift: hasOpenShiftTop } = useRequireCashShift(salonId)

  const update = useUpdateVisit(salonId)
  const remove = useDeleteVisit(salonId)
  const createVisit = useCreateVisit(salonId)

  const allPaid = groupLines.length > 0 && groupLines.every((v) => v.status === 'paid')
  const total = groupLines.reduce(
    (acc, v) => acc + v.amount_cents - v.discount_cents + v.tip_cents,
    0,
  )
  const client = visit?.client_id ? (clients.find((c) => c.id === visit.client_id) ?? null) : null

  if (!visit) return null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 p-0 sm:!max-w-[560px]">
        {view === 'detail' ? (
          <DetailView
            visit={visit}
            client={client}
            groupLines={groupLines}
            services={services}
            staff={staff}
            paymentMethods={paymentMethods}
            currency={currency}
            allPaid={allPaid}
            total={total}
            tab={tab}
            onTabChange={setTab}
            editingLineId={editingLineId}
            onEdit={setEditingLineId}
            onPatchLine={(id, patch) =>
              update.mutate(
                { id, ...patch },
                { onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) },
              )
            }
            onDeleteLine={(id) => {
              if (!confirm(t('visits.confirm_delete'))) return
              remove.mutate(id, {
                onSuccess: () => toast.success(t('visits.toast_deleted')),
              })
            }}
            onAddService={async (serviceId) => {
              const svc = services.find((s) => s.id === serviceId)
              if (!svc || !visit) return
              // 1. Гарантируем group_key — если у текущего визита его ещё нет,
              //    генерим новый и патчим существующий, иначе берём из visit.
              let groupKey = visit.group_key
              if (!groupKey) {
                groupKey =
                  typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `g-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
                try {
                  await update.mutateAsync({ id: visit.id, group_key: groupKey })
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e))
                  return
                }
              }
              // 2. Время — после последней линии группы. duration_min или 60.
              const last = groupLines[groupLines.length - 1] ?? visit
              const lastDur = last.duration_min ?? svc.default_duration_min ?? 60
              const newAt = new Date(
                new Date(last.visit_at).getTime() + lastDur * 60_000,
              ).toISOString()
              try {
                await createVisit.mutateAsync({
                  salon_id: salonId,
                  visit_at: newAt,
                  staff_id: last.staff_id ?? null,
                  client_id: last.client_id ?? null,
                  service_id: svc.id,
                  service_name_snapshot: svc.name,
                  amount_cents: svc.default_price_cents ?? 0,
                  payment_method: last.payment_method,
                  group_key: groupKey,
                  duration_min: svc.default_duration_min ?? null,
                  // Новая услуга — pending: владелец сам решит когда charge'нуть
                  // всю группу (allPaid становится false и появится кнопка Рассчитать).
                  status: 'pending',
                  cash_register_id: last.cash_register_id ?? null,
                })
                toast.success(t('visits.detail.toast_service_added'))
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e))
              }
            }}
            onChargeClick={() => {
              if (!hasOpenShiftTop) {
                setGateOpen(true)
                return
              }
              setView('charge')
            }}
            onClose={onClose}
            t={t}
          />
        ) : view === 'charge' ? (
          <ChargeView
            salonId={salonId}
            groupLines={groupLines}
            cashRegisters={cashRegisters}
            currency={currency}
            onBack={() => {
              if (onBackFromCharge && visit) {
                onClose()
                // Маленькая задержка — чтобы Dialog успел закрыться раньше
                // открытия следующей модалки (QuickEntryModal). Иначе Radix
                // может зацепить focus-trap и моргнуть.
                setTimeout(() => onBackFromCharge(visit), 50)
              } else {
                setView('detail')
              }
            }}
            onCharged={() => setView('document')}
            t={t}
          />
        ) : (
          <DocumentView
            groupLines={groupLines}
            onDone={() => {
              toast.success(t('visits.charge.toast_paid'))
              onClose()
            }}
            t={t}
          />
        )}
      </DialogContent>
      <CashGateRequiredDialog
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        salonId={salonId}
        action="visit_charge"
        onShiftOpened={() => setView('charge')}
      />
    </Dialog>
  )
}

// =============================================================================
// Detail view — список услуг визита
// =============================================================================

type DetailViewProps = {
  visit: VisitRow
  client: { id: string; name: string } | null
  groupLines: VisitRow[]
  services: Array<{
    id: string
    name: string
    default_duration_min: number | null
    default_price_cents?: number
    is_archived?: boolean
  }>
  staff: Array<{ id: string; full_name: string }>
  paymentMethods: Array<{ code: PaymentMethod; label: string }>
  currency: string
  allPaid: boolean
  total: number
  tab: 'wizyta' | 'info'
  onTabChange: (t: 'wizyta' | 'info') => void
  editingLineId: string | null
  onEdit: (id: string | null) => void
  onPatchLine: (id: string, patch: Partial<VisitRow>) => void
  onDeleteLine: (id: string) => void
  onAddService: (serviceId: string) => void | Promise<void>
  onChargeClick: () => void
  onClose: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

function DetailView({
  visit,
  client,
  groupLines,
  services,
  staff,
  paymentMethods,
  currency,
  allPaid,
  total,
  tab,
  onTabChange,
  editingLineId,
  onEdit,
  onPatchLine,
  onDeleteLine,
  onAddService,
  onChargeClick,
  onClose,
  t,
}: DetailViewProps) {
  const [addingService, setAddingService] = useState(false)
  const [addingValue, setAddingValue] = useState('')
  const headerLabel = allPaid ? t('visits.detail.status_paid') : t('visits.detail.status_confirmed')
  const dateLabel = format(new Date(visit.visit_at), 'EEEE, d MMMM', { locale: getDateLocale() })

  return (
    <div className="flex max-h-[85vh] flex-col">
      {/* Шапка в стиле остальных модалок портала (image #75): без яркой
          цветной плашки и без второй X-кнопки (Radix DialogContent уже
          рендерит свой close-крестик в правом верхнем углу). Статус
          вынесен в pill рядом с именем клиента, окрашен брендовыми
          токенами sage (paid) / teal (confirmed). */}
      <div className="border-border flex items-center gap-3 border-b px-5 py-4 pr-12">
        <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full">
          <User className="size-5" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-brand-navy truncate text-base font-bold">
              {client?.name ?? t('visits.detail.no_client')}
            </p>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                allPaid
                  ? 'bg-brand-sage-soft text-brand-sage-deep'
                  : 'bg-brand-teal-soft text-brand-teal-deep',
              )}
            >
              {headerLabel}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">{dateLabel}</p>
        </div>
      </div>

      {/* Tabs */}
      <nav className="border-border flex border-b">
        {(['wizyta', 'info'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={cn(
              'flex-1 border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors',
              tab === id
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {t(`visits.detail.tabs.${id}`)}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tab === 'wizyta' ? (
          <div className="flex flex-col gap-3">
            {groupLines.map((v) => {
              const svc = v.service_id ? services.find((s) => s.id === v.service_id) : null
              const stf = v.staff_id ? staff.find((s) => s.id === v.staff_id) : null
              const dur = svc?.default_duration_min ?? 60
              const start = new Date(v.visit_at)
              const end = new Date(start.getTime() + dur * 60_000)
              const lineTotal = v.amount_cents - v.discount_cents + v.tip_cents
              const isEditing = editingLineId === v.id
              return (
                <div key={v.id} className="border-border bg-card overflow-hidden rounded-lg border">
                  <div className="border-l-4 border-pink-400 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-foreground text-sm font-bold">
                          {svc?.name ?? v.service_name_snapshot ?? '—'} ·{' '}
                          <span className="num">{formatCurrency(lineTotal, currency)}</span>
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px]">
                          {format(start, 'HH:mm')} - {format(end, 'HH:mm')} · {dur}min
                        </p>
                        {stf ? (
                          <p className="text-muted-foreground mt-1 text-[11px]">
                            {t('visits.detail.staff_label')}: {stf.full_name}
                          </p>
                        ) : null}
                        {v.status === 'paid' ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                            <CheckCircle2 className="size-3" strokeWidth={2.5} />
                            {t('visits.detail.line_paid')}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(isEditing ? null : v.id)}
                          className="text-muted-foreground hover:text-primary grid size-8 place-items-center rounded-md"
                          aria-label={t('common.edit')}
                        >
                          <Edit2 className="size-3.5" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteLine(v.id)}
                          className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>

                    {isEditing ? (
                      <LineEditor
                        visit={v}
                        currency={currency}
                        paymentMethods={paymentMethods}
                        onSave={(patch) => {
                          onPatchLine(v.id, patch)
                          onEdit(null)
                        }}
                        onCancel={() => onEdit(null)}
                        t={t}
                      />
                    ) : null}
                  </div>
                </div>
              )
            })}

            {/* «+ Добавить услугу» — inline picker. Создаёт новый visit с тем
                же group_key (или генерит group_key если его ещё нет — тогда
                и текущий визит, и новый объединяются в группу). */}
            {addingService ? (
              <div className="border-primary/30 bg-card rounded-lg border-2 border-dashed p-3">
                <Label
                  htmlFor="detail-add-service"
                  className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider"
                >
                  {t('visits.detail.add_service_label')}
                </Label>
                <select
                  id="detail-add-service"
                  autoFocus
                  value={addingValue}
                  onChange={(e) => setAddingValue(e.target.value)}
                  className="border-border bg-background focus:border-primary mt-1.5 h-10 w-full rounded-md border px-3 text-sm outline-none"
                >
                  <option value="">{t('visits.detail.add_service_placeholder')}</option>
                  {services
                    .filter((s) => !s.is_archived)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.default_price_cents
                          ? ` · ${formatCurrency(s.default_price_cents, currency)}`
                          : ''}
                      </option>
                    ))}
                </select>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAddingService(false)
                      setAddingValue('')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!addingValue}
                    onClick={async () => {
                      if (!addingValue) return
                      const id = addingValue
                      setAddingService(false)
                      setAddingValue('')
                      await onAddService(id)
                    }}
                  >
                    {t('visits.detail.add_service_submit')}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingService(true)}
                className="border-border text-muted-foreground hover:border-primary hover:text-primary inline-flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm font-semibold transition-colors"
              >
                <Plus className="size-4" strokeWidth={2} />
                {t('visits.detail.add_service')}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
              {t('visits.detail.note_label')}
            </Label>
            <textarea
              className="border-border bg-card focus:border-primary min-h-[100px] resize-none rounded-md border p-3 text-sm outline-none"
              defaultValue={visit.comment ?? ''}
              placeholder={t('visits.detail.note_placeholder')}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if ((v || null) !== (visit.comment ?? null)) {
                  onPatchLine(visit.id, { comment: v || null })
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            {t('visits.detail.total')}
          </p>
          <p className="num text-foreground text-xl font-bold">{formatCurrency(total, currency)}</p>
        </div>
        {allPaid ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <Button onClick={onChargeClick}>
            <Receipt className="size-4" strokeWidth={2} />
            {t('visits.detail.charge')}
          </Button>
        )}
      </footer>
    </div>
  )
}

// =============================================================================
// Inline line editor — amount/discount inside detail
// =============================================================================

function LineEditor({
  visit,
  currency,
  onSave,
  onCancel,
  t,
}: {
  visit: VisitRow
  currency: string
  paymentMethods: Array<{ code: PaymentMethod; label: string }>
  onSave: (patch: Partial<VisitRow>) => void
  onCancel: () => void
  t: (k: string) => string
}) {
  const [amount, setAmount] = useState(String((visit.amount_cents / 100).toFixed(2)))
  const [discount, setDiscount] = useState(String((visit.discount_cents / 100).toFixed(2)))

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-muted-foreground text-[10px] font-semibold uppercase">
            {t('visits.detail.line_amount')} ({currency})
          </Label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-muted-foreground text-[10px] font-semibold uppercase">
            {t('visits.detail.line_discount')} ({currency})
          </Label>
          <Input
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const a = Math.round(Number(amount.replace(',', '.')) * 100) || 0
            const d = Math.round(Number(discount.replace(',', '.')) * 100) || 0
            onSave({ amount_cents: a, discount_cents: d })
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
// Charge view — выбор tip / payment / submit
// =============================================================================

const TIP_PRESETS = [
  { id: 'none', pctLabel: 'visits.charge.tip_none', pct: 0 },
  { id: 'p5', pctLabel: 'visits.charge.tip_5', pct: 5 },
  { id: 'p10', pctLabel: 'visits.charge.tip_10', pct: 10 },
  { id: 'p20', pctLabel: 'visits.charge.tip_20', pct: 20 },
] as const

function ChargeView({
  salonId,
  groupLines,
  cashRegisters,
  currency,
  onBack,
  onCharged,
  t,
}: {
  salonId: string
  groupLines: VisitRow[]
  /** Image #82: вместо paymentMethods — список касс. ID кассы пишется
   *  в visits.cash_register_id, payment_method остаётся 'card' для
   *  обратной совместимости (старая аналитика). */
  cashRegisters: Array<{ id: string; label: string }>
  currency: string
  onBack: () => void
  onCharged: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const qc = useQueryClient()
  const { hasOpenShift } = useRequireCashShift(salonId)
  const baseTotalCents = groupLines.reduce((acc, v) => acc + v.amount_cents - v.discount_cents, 0)
  const [tipPreset, setTipPreset] = useState<string>('none')
  const [customTipStr, setCustomTipStr] = useState('')
  const [chargeGateOpen, setChargeGateOpen] = useState(false)
  const [cashRegisterId, setCashRegisterId] = useState<string>(cashRegisters[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const customTipCents = Math.max(0, Math.round(Number(customTipStr.replace(',', '.')) * 100)) || 0
  const presetTipCents = useMemo(() => {
    const p = TIP_PRESETS.find((tp) => tp.id === tipPreset)
    if (!p || p.pct === 0) return 0
    return Math.round((baseTotalCents * p.pct) / 100)
  }, [tipPreset, baseTotalCents])
  const tipCents = tipPreset === 'custom' ? customTipCents : presetTipCents
  const grandTotal = baseTotalCents + tipCents

  async function chargeAll() {
    // Per-user касса: расчёт визита требует открытую смену текущего юзера.
    if (!hasOpenShift) {
      setChargeGateOpen(true)
      return
    }
    setBusy(true)
    try {
      // Распределяем tip пропорционально по линиям (если их несколько).
      const totalBase = baseTotalCents || 1
      for (const v of groupLines) {
        if (v.status === 'paid') continue
        const lineBase = v.amount_cents - v.discount_cents
        const lineTip = tipCents > 0 ? Math.round((tipCents * lineBase) / totalBase) : 0
        const { error } = await supabase
          .from('visits')
          .update({
            cash_register_id: cashRegisterId || null,
            tip_cents: lineTip,
            status: 'paid',
          })
          .eq('id', v.id)
        if (error) throw error
      }
      // Image #88: после расчёта инвалидируем visits + dashboard, чтобы
      // галочка «оплачено» на календаре появилась сразу, без reload.
      await Promise.all([
        qc.invalidateQueries({ queryKey: visitsKeys(salonId) }),
        qc.invalidateQueries({ queryKey: ['dashboard', salonId] }),
      ])
      onCharged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-h-[85vh] flex-col">
      <header className="border-border flex items-center gap-3 border-b px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {t('common.back')}
        </button>
        <p className="text-foreground flex-1 text-center text-sm font-bold">
          {t('visits.charge.title')}
        </p>
        <span className="w-12" />
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="bg-brand-yellow border-brand-yellow-deep mb-5 rounded-md border-[1.5px] p-4 text-center">
          <p className="text-brand-navy/70 text-[11px] font-bold uppercase tracking-wider">
            {t('visits.charge.total_to_pay')}
          </p>
          <p className="num text-brand-navy mt-1 text-3xl font-bold">
            {formatCurrency(grandTotal, currency)}
          </p>
          {tipCents > 0 ? (
            <p className="text-brand-navy/70 mt-1 text-[11px]">
              {t('visits.charge.base')}: {formatCurrency(baseTotalCents, currency)} +{' '}
              {t('visits.charge.tip')}: {formatCurrency(tipCents, currency)}
            </p>
          ) : null}
        </div>

        <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          {t('visits.charge.tip_label')}
        </Label>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {TIP_PRESETS.map((tp) => (
            <button
              key={tp.id}
              type="button"
              onClick={() => setTipPreset(tp.id)}
              className={cn(
                'border-border flex flex-col items-center rounded-md border-[1.5px] py-2 text-xs font-semibold transition-colors',
                tipPreset === tp.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card',
              )}
            >
              <span>{t(tp.pctLabel)}</span>
              {tp.pct > 0 ? (
                <span className="text-[10px] opacity-70">
                  {formatCurrency(Math.round((baseTotalCents * tp.pct) / 100), currency)}
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTipPreset('custom')}
            className={cn(
              'border-border rounded-md border-[1.5px] py-2 text-xs font-semibold transition-colors',
              tipPreset === 'custom'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card',
            )}
          >
            {t('visits.charge.tip_custom')}
          </button>
        </div>
        {tipPreset === 'custom' ? (
          <Input
            inputMode="decimal"
            value={customTipStr}
            onChange={(e) => setCustomTipStr(e.target.value)}
            placeholder="0"
            className="mt-2"
          />
        ) : null}

        <Label className="text-muted-foreground mt-5 block text-[11px] font-bold uppercase tracking-wider">
          {t('visits.charge.cash_register')}
        </Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {cashRegisters.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('visits.charge.cash_register_empty')}
            </p>
          ) : (
            cashRegisters.map((r) => {
              const active = cashRegisterId === r.id
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setCashRegisterId(r.id)}
                  className={cn(
                    'h-10 rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-muted/40',
                  )}
                >
                  {r.label}
                </button>
              )
            })
          )}
        </div>
      </div>

      <footer className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button onClick={chargeAll} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
          {t('visits.charge.confirm')}
        </Button>
      </footer>
      <CashGateRequiredDialog
        open={chargeGateOpen}
        onClose={() => setChargeGateOpen(false)}
        salonId={salonId}
        action="visit_charge"
        onShiftOpened={() => void chargeAll()}
      />
    </div>
  )
}

// =============================================================================
// Document view — Чек / Фактура / Пропустить
// =============================================================================

function DocumentView({
  groupLines,
  onDone,
  t,
}: {
  groupLines: VisitRow[]
  onDone: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const [busy, setBusy] = useState(false)

  async function pick(kind: 'receipt' | 'invoice' | 'skip') {
    setBusy(true)
    try {
      if (kind !== 'skip') {
        const docTag = kind === 'receipt' ? '[Чек]' : '[Фактура]'
        for (const v of groupLines) {
          const existing = v.comment ?? ''
          if (existing.includes(docTag)) continue
          const next = existing ? `${existing} ${docTag}` : docTag
          await supabase.from('visits').update({ comment: next }).eq('id', v.id)
        }
      }
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const options = [
    {
      id: 'receipt' as const,
      label: t('visits.charge.doc_receipt'),
      hint: t('visits.charge.doc_receipt_hint'),
      icon: Receipt,
    },
    {
      id: 'invoice' as const,
      label: t('visits.charge.doc_invoice'),
      hint: t('visits.charge.doc_invoice_hint'),
      icon: FileText,
    },
    {
      id: 'skip' as const,
      label: t('visits.charge.doc_skip'),
      hint: t('visits.charge.doc_skip_hint'),
      icon: SkipForward,
    },
  ]

  return (
    <div className="flex max-h-[85vh] flex-col">
      <header className="border-border border-b px-5 py-3 text-center">
        <p className="text-foreground text-sm font-bold">{t('visits.charge.doc_title')}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{t('visits.charge.doc_subtitle')}</p>
      </header>

      <div className="flex flex-col gap-2 p-5">
        {options.map((o) => {
          const Icon = o.icon
          return (
            <button
              key={o.id}
              type="button"
              disabled={busy}
              onClick={() => pick(o.id)}
              className="border-border hover:border-primary hover:bg-primary/5 bg-card flex items-center gap-3 rounded-md border p-3 text-left transition-colors disabled:opacity-50"
            >
              <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md">
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">{o.label}</p>
                <p className="text-muted-foreground text-[11px]">{o.hint}</p>
              </span>
              <Clock className="text-muted-foreground size-4" strokeWidth={1.8} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
