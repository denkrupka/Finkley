import { format } from 'date-fns'
import {
  CheckCircle2,
  Clock,
  Edit2,
  FileText,
  Landmark,
  Link2,
  Link2Off,
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
import { useBankLinkedIncomeIds } from '@/hooks/useBanking'
import { useClients } from '@/hooks/useClients'
import { useRequireCashShift } from '@/hooks/useCashShifts'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import { useIsVatPayer } from '@/hooks/useIsVatPayer'
import { useSalon } from '@/hooks/useSalons'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { computeNet, defaultVatRate } from '@/lib/utils/vat'
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
import { LinkVisitToBankDialog } from '@/routes/banking/LinkVisitToBankDialog'

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
  const [view, setView] = useState<'detail' | 'charge' | 'document' | 'next-visit'>(
    initialView ?? 'detail',
  )
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
            salonId={salonId}
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
        ) : view === 'document' ? (
          <DocumentView
            salonId={salonId}
            groupLines={groupLines}
            onDone={() => {
              toast.success(t('visits.charge.toast_paid'))
              setView('next-visit')
            }}
            t={t}
          />
        ) : (
          <NextVisitPromptView
            visit={visit}
            services={services}
            staff={staff}
            onDone={() => {
              // Триггерим review-request invoke сразу (single-visit mode).
              // Edge function сама проверит broadcast_prefs и анти-дубль (1 раз
              // на visit_id). Поэтому здесь не нужно ничего fetch'ить, fire-and-forget.
              supabase.functions
                .invoke('send-review-request', { body: { visit_id: visit.id } })
                .then((res) => {
                  if (res.data?.sent) {
                    toast.success(t('visits.next_prompt.review_sent'))
                  }
                })
                .catch((err) => {
                  // Тихо — пользователь не должен видеть ошибку этого фонового действия.
                  console.warn('send-review-request invoke failed:', err)
                })
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
  salonId: string
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
  salonId,
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
  const [bankPickerOpen, setBankPickerOpen] = useState(false)
  const [bankUnlinking, setBankUnlinking] = useState(false)
  const qc = useQueryClient()
  const { data: bankLinked } = useBankLinkedIncomeIds(salonId)
  // Bank-секция — только для одиночного оплаченного визита. Группы (retail-
  // wizard'ы из 2+ позиций) оставляем как есть: одна общая оплата может быть
  // привязана к любому из них, и UI с per-line кнопками был бы шумным.
  const showBankSection = allPaid && groupLines.length === 1
  const isBankLinked = bankLinked?.visitIds.has(visit.id) ?? false

  async function handleUnlinkBank() {
    setBankUnlinking(true)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ linked_visit_id: null })
        .eq('linked_visit_id', visit.id)
      if (error) throw error
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['bank-linked-income-ids', salonId] }),
        qc.invalidateQueries({ queryKey: ['bank-inflows', salonId] }),
        qc.invalidateQueries({ queryKey: ['visits', salonId] }),
      ])
      toast.success(t('banking.unlink_toast'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBankUnlinking(false)
    }
  }
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

      {showBankSection ? (
        <div className="border-border bg-muted/30 flex items-center justify-between gap-2 border-t px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Landmark
              className={cn(
                'size-4 shrink-0',
                isBankLinked ? 'text-brand-teal-deep' : 'text-muted-foreground',
              )}
              strokeWidth={1.8}
            />
            <span
              className={cn(
                'truncate font-semibold',
                isBankLinked ? 'text-brand-teal-deep' : 'text-muted-foreground',
              )}
            >
              {isBankLinked ? t('banking.linked_to_bank') : t('banking.not_linked_hint')}
            </span>
          </div>
          {isBankLinked ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUnlinkBank}
              disabled={bankUnlinking}
              className="shrink-0"
            >
              <Link2Off className="size-3.5" strokeWidth={2} />
              {t('banking.unlink')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBankPickerOpen(true)}
              className="shrink-0"
            >
              <Link2 className="size-3.5" strokeWidth={2} />
              {t('banking.link_to_bank')}
            </Button>
          )}
        </div>
      ) : null}

      {/* Footer */}
      <footer className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            {t('visits.detail.total')}
          </p>
          <p className="num text-foreground text-xl font-bold">{formatCurrency(total, currency)}</p>
          {/* Image #51: partial-info — если визит частично получен,
              показываем разбивку получено/осталось. */}
          {groupLines.length === 1 && groupLines[0]?.paid_amount_cents != null ? (
            <p className="num mt-0.5 text-[11px] font-semibold text-amber-700">
              {t('visits.detail.partial_received', {
                paid: formatCurrency(groupLines[0].paid_amount_cents, currency),
                remaining: formatCurrency(
                  Math.max(0, total - groupLines[0].paid_amount_cents),
                  currency,
                ),
              })}
            </p>
          ) : null}
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

      <LinkVisitToBankDialog
        open={bankPickerOpen}
        onOpenChange={setBankPickerOpen}
        salonId={salonId}
        currency={currency}
        visit={{
          id: visit.id,
          amount_cents: total,
          visit_at: visit.visit_at,
          title: client?.name ?? services.find((s) => s.id === visit.service_id)?.name ?? '—',
        }}
      />
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
  currency,
  onBack,
  onCharged,
  t,
}: {
  salonId: string
  groupLines: VisitRow[]
  currency: string
  onBack: () => void
  onCharged: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const qc = useQueryClient()
  const { hasOpenShift } = useRequireCashShift(salonId)
  // T17 — селектор «Касса» заменён на «Метод оплаты». Список берётся из
  // payment_methods directory; при выборе метода visits.payment_method
  // обновляется (для аналитики), а visits.cash_register_id — из mapping
  // выбранного метода (payment_methods.cash_register_id).
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  // grossTotalCents — сумма amount_cents всех линий (до скидки), на ней считаем
  // процентную скидку. discount применяется ко всему чеку.
  const grossTotalCents = groupLines.reduce((acc, v) => acc + v.amount_cents, 0)
  const [tipPreset, setTipPreset] = useState<string>('none')
  const [customTipStr, setCustomTipStr] = useState('')
  const [chargeGateOpen, setChargeGateOpen] = useState(false)
  const [paymentMethodCode, setPaymentMethodCode] = useState<string>(paymentMethods[0]?.code ?? '')
  const cashRegisterId = useMemo(() => {
    const m = paymentMethods.find((x) => x.code === paymentMethodCode)
    return m?.cash_register_id ?? ''
  }, [paymentMethods, paymentMethodCode])
  const [busy, setBusy] = useState(false)

  // ---- Скидка ----
  const [discountMode, setDiscountMode] = useState<'none' | 'percent' | 'amount'>('none')
  const [discountPctStr, setDiscountPctStr] = useState('')
  const [discountAmountStr, setDiscountAmountStr] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const discountCents = useMemo(() => {
    if (discountMode === 'percent') {
      const pct = Math.max(0, Math.min(100, Number(discountPctStr.replace(',', '.')) || 0))
      return Math.round((grossTotalCents * pct) / 100)
    }
    if (discountMode === 'amount') {
      const amt = Math.max(0, Math.round(Number(discountAmountStr.replace(',', '.')) * 100) || 0)
      return Math.min(amt, grossTotalCents)
    }
    return 0
  }, [discountMode, discountPctStr, discountAmountStr, grossTotalCents])
  const baseTotalCents = grossTotalCents - discountCents

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
    if (discountMode !== 'none' && discountCents > 0 && !discountReason.trim()) {
      toast.error(t('visits.charge.discount_reason_required'))
      return
    }
    setBusy(true)
    try {
      // Распределяем tip + discount пропорционально по линиям (если их несколько).
      const totalGross = grossTotalCents || 1
      for (const v of groupLines) {
        if (v.status === 'paid') continue
        const lineDiscount =
          discountCents > 0 ? Math.round((discountCents * v.amount_cents) / totalGross) : 0
        const lineBase = v.amount_cents - lineDiscount
        const lineTip = tipCents > 0 ? Math.round((tipCents * lineBase) / baseTotalCents) : 0
        const { error } = await supabase
          .from('visits')
          .update({
            cash_register_id: cashRegisterId || null,
            payment_method: (paymentMethodCode || null) as PaymentMethod | null,
            tip_cents: lineTip,
            discount_cents: lineDiscount,
            discount_reason: discountCents > 0 ? discountReason.trim() : null,
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
          {discountCents > 0 || tipCents > 0 ? (
            <p className="text-brand-navy/70 mt-1 text-[11px]">
              {formatCurrency(grossTotalCents, currency)}
              {discountCents > 0 ? ` − ${formatCurrency(discountCents, currency)}` : ''}
              {tipCents > 0 ? ` + ${formatCurrency(tipCents, currency)}` : ''}
            </p>
          ) : null}
        </div>

        <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          {t('visits.charge.discount_label')}
        </Label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setDiscountMode('none')}
            className={cn(
              'border-border rounded-md border-[1.5px] py-2 text-xs font-semibold transition-colors',
              discountMode === 'none'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card',
            )}
          >
            {t('visits.charge.discount_none')}
          </button>
          <button
            type="button"
            onClick={() => setDiscountMode('percent')}
            className={cn(
              'border-border rounded-md border-[1.5px] py-2 text-xs font-semibold transition-colors',
              discountMode === 'percent'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card',
            )}
          >
            {t('visits.charge.discount_percent')}
          </button>
          <button
            type="button"
            onClick={() => setDiscountMode('amount')}
            className={cn(
              'border-border rounded-md border-[1.5px] py-2 text-xs font-semibold transition-colors',
              discountMode === 'amount'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card',
            )}
          >
            {t('visits.charge.discount_amount')}
          </button>
        </div>
        {discountMode === 'percent' ? (
          <Input
            inputMode="decimal"
            value={discountPctStr}
            onChange={(e) => setDiscountPctStr(e.target.value)}
            placeholder="10"
            className="mt-2"
          />
        ) : null}
        {discountMode === 'amount' ? (
          <Input
            inputMode="decimal"
            value={discountAmountStr}
            onChange={(e) => setDiscountAmountStr(e.target.value)}
            placeholder="20"
            className="mt-2"
          />
        ) : null}
        {discountMode !== 'none' && discountCents > 0 ? (
          <div className="mt-2">
            <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              {t('visits.charge.discount_reason')} *
            </Label>
            <Input
              value={discountReason}
              onChange={(e) => setDiscountReason(e.target.value)}
              placeholder={t('visits.charge.discount_reason_placeholder')}
              className="mt-1"
            />
          </div>
        ) : null}

        <Label className="text-muted-foreground mt-5 block text-[11px] font-bold uppercase tracking-wider">
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
          {t('visits.charge.payment_method')}
        </Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {paymentMethods.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('visits.charge.payment_method_empty')}
            </p>
          ) : (
            paymentMethods.map((m) => {
              const active = paymentMethodCode === m.code
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethodCode(m.code)}
                  className={cn(
                    'h-10 rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-muted/40',
                  )}
                >
                  {m.label}
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
// Next-visit prompt — после расчёта и документа, напоминание записать клиента
// на следующий визит. Скрипт «Работа с возражениями» — отдельная модалка
// со скриптом администратора (PDF: Раздел 4 + 1.3 + 5.1).
// =============================================================================

/** Парсит строку **text** в <strong className="text-foreground font-bold">text</strong>. */
function renderWithBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-foreground font-bold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function NextVisitPromptView({
  visit,
  services,
  staff,
  onDone,
  t,
}: {
  visit: VisitRow
  services: Array<{ id: string; name: string; default_duration_min: number | null }>
  staff: Array<{ id: string; full_name: string }>
  onDone: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const [showScript, setShowScript] = useState(false)
  // Дата = visit.visit_at + 3 недели (21 день).
  const futureDate = new Date(new Date(visit.visit_at).getTime() + 21 * 24 * 60 * 60 * 1000)
  const dateLabel = format(futureDate, 'd MMMM yyyy', { locale: getDateLocale() })
  const masterName = staff.find((s) => s.id === visit.staff_id)?.full_name ?? '—'
  const serviceName =
    services.find((s) => s.id === visit.service_id)?.name ?? visit.service_name_snapshot ?? '—'
  const otherMaster =
    staff.find((s) => s.id !== visit.staff_id)?.full_name ??
    t('visits.script.other_master_fallback')
  const duration = String(
    services.find((s) => s.id === visit.service_id)?.default_duration_min ??
      visit.duration_min ??
      30,
  )
  const scriptVars = {
    date: dateLabel,
    master: masterName,
    service: serviceName,
    otherMaster,
    duration,
  }
  if (showScript) {
    return (
      <ObjectionsScriptView
        onBack={() => setShowScript(false)}
        onDone={onDone}
        t={t}
        vars={scriptVars}
      />
    )
  }
  return (
    <div className="flex flex-col">
      <div className="border-border flex items-center gap-3 border-b px-5 py-4 pr-12">
        <span className="bg-brand-yellow/40 text-brand-navy grid size-10 shrink-0 place-items-center rounded-full">
          <Clock className="size-5" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-brand-navy text-base font-bold">{t('visits.next_prompt.title')}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{t('visits.next_prompt.subtitle')}</p>
        </div>
      </div>
      <div className="px-5 py-6">
        <div className="border-brand-gold-soft bg-brand-gold-soft/30 mb-4 rounded-lg border p-4">
          <p className="text-brand-navy text-sm">
            <strong>{t('visits.next_prompt.script_label')}</strong>
          </p>
          <p className="text-foreground mt-2 text-sm italic leading-relaxed">
            {renderWithBold(t('visits.next_prompt.script_body', { date: dateLabel }))}
          </p>
        </div>
        <p className="text-muted-foreground text-xs">{t('visits.next_prompt.hint_loss')}</p>
      </div>
      <div className="border-border bg-muted/10 flex gap-2 border-t px-5 py-4">
        {/* bug 23afc33e — кнопка «Работа с возражениями» теперь зелёная
            (заметнее для администратора, owner-feedback). */}
        <Button
          variant="outline"
          onClick={() => setShowScript(true)}
          className="bg-brand-sage-soft text-brand-sage-deep hover:bg-brand-sage-soft/80 border-brand-sage/40 flex-1"
        >
          {t('visits.next_prompt.objections_button')}
        </Button>
        <Button onClick={onDone} className="flex-1">
          {t('visits.next_prompt.ok_button')}
        </Button>
      </div>
    </div>
  )
}

function ObjectionsScriptView({
  onBack,
  onDone,
  t,
  vars,
}: {
  onBack: () => void
  onDone: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
  vars: { date: string; master: string; service: string; otherMaster: string; duration: string }
}) {
  // Скрипт из PDF Wonderful Beauty Admin (Раздел 4 — типичные возражения +
  // Раздел 1.3 — расчёт и следующая запись + Раздел 5 — реактивация).
  const objections: Array<{ situationKey: string; replyKey: string }> = [
    { situationKey: 'visits.script.case1_situation', replyKey: 'visits.script.case1_reply' },
    { situationKey: 'visits.script.case2_situation', replyKey: 'visits.script.case2_reply' },
    { situationKey: 'visits.script.case3_situation', replyKey: 'visits.script.case3_reply' },
    { situationKey: 'visits.script.case4_situation', replyKey: 'visits.script.case4_reply' },
    { situationKey: 'visits.script.case5_situation', replyKey: 'visits.script.case5_reply' },
  ]
  return (
    <div className="flex max-h-[85vh] flex-col">
      <div className="border-border flex items-center gap-3 border-b px-5 py-4 pr-12">
        <span className="bg-brand-teal-soft text-brand-teal-deep grid size-10 shrink-0 place-items-center rounded-full">
          <FileText className="size-5" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-brand-navy text-base font-bold">{t('visits.script.title')}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{t('visits.script.subtitle')}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="border-brand-sage-soft bg-brand-sage-soft/30 mb-4 rounded-lg border p-4">
          <p className="text-brand-navy text-sm font-bold">
            ✓ {t('visits.script.golden_rule_title')}
          </p>
          <p className="text-foreground mt-1 text-sm">{t('visits.script.golden_rule_body')}</p>
        </div>
        <div className="flex flex-col gap-3">
          {objections.map((o, idx) => (
            <div key={idx} className="border-border bg-card rounded-lg border p-3">
              <p className="text-brand-navy mb-1.5 text-xs font-bold italic">
                «{t(o.situationKey)}»
              </p>
              <p className="text-foreground text-sm leading-relaxed">
                {renderWithBold(t(o.replyKey, vars))}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="border-border bg-muted/10 flex gap-2 border-t px-5 py-4">
        <Button variant="outline" onClick={onBack} className="flex-1">
          {t('common.back')}
        </Button>
        <Button onClick={onDone} className="flex-1">
          {t('visits.next_prompt.ok_button')}
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
// Document view — Чек / Фактура / Пропустить
// =============================================================================

function DocumentView({
  salonId,
  groupLines,
  onDone,
  t,
}: {
  salonId: string
  groupLines: VisitRow[]
  onDone: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const [busy, setBusy] = useState(false)
  const isVatPayer = useIsVatPayer(salonId)
  const { data: salonData } = useSalon(salonId)
  const country = salonData?.country_code ?? 'PL'

  async function pick(kind: 'receipt' | 'invoice' | 'skip') {
    setBusy(true)
    try {
      // VAT-логика юзера #47 при выборе документа:
      // - !isVatPayer → не трогаем VAT-поля (P&L fallback на amount_cents)
      // - skip & isVatPayer → vat_skipped=true, нетто=брутто, ставка=0
      //   (деньги приняли, фискаль не выбит — vatBreakdownFor исключит из VAT)
      // - receipt/invoice & isVatPayer → нетто=net(брутто,defaultRate),
      //   vat_skipped=false. Ставка по дефолту страны.
      const docSkipped = kind === 'skip'
      const vatRate = isVatPayer && !docSkipped ? defaultVatRate(country) : 0
      const vatSkippedFlag = isVatPayer && docSkipped
      const docTag = kind === 'receipt' ? '[Чек]' : kind === 'invoice' ? '[Фактура]' : null

      for (const v of groupLines) {
        const patch: Record<string, unknown> = {}
        if (docTag) {
          const existing = v.comment ?? ''
          if (!existing.includes(docTag)) {
            patch.comment = existing ? `${existing} ${docTag}` : docTag
          }
        }
        if (isVatPayer) {
          patch.amount_net_cents = docSkipped ? v.amount_cents : computeNet(v.amount_cents, vatRate)
          patch.vat_rate_pct = vatRate
          patch.vat_skipped = vatSkippedFlag
        }
        if (Object.keys(patch).length > 0) {
          await supabase.from('visits').update(patch).eq('id', v.id)
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
