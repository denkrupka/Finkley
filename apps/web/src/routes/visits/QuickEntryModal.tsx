import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ArrowDown, ArrowUp, CalendarDays, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CashGateRequiredDialog } from '@/components/CashGateRequiredDialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { supabase } from '@/lib/supabase/client'
import { useCreateBooksyReservation } from '@/hooks/useBooksyReservation'
import { useSalonIntegrations } from '@/hooks/useIntegrations'
import { useSuggestedStaffForClientService } from '@/hooks/useStaffSuggestion'
import { useRequireCashShift } from '@/hooks/useCashShifts'
import {
  useCreateVisit,
  useDeleteVisit,
  useRestoreVisit,
  useUpdateVisit,
  type VisitRow,
} from '@/hooks/useVisits'
import { useInventoryItems } from '@/hooks/useInventory'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { formatCurrency } from '@/lib/utils/format-currency'
import { cn } from '@/lib/utils/cn'
import { useClient } from '@/hooks/useClients'
import { ClientPicker } from '@/routes/clients/ClientPicker'
import { VisitReceiptModal } from '@/routes/visits/VisitReceiptModal'

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

const LAST_STAFF_KEY = 'finkley:last-staff'
const LAST_PAYMENT_KEY = 'finkley:last-payment'

type ServiceLine = {
  /** Локальный uuid для key/remove — не путать с service_id из БД. */
  uid: string
  service_id: string
  name: string
  price_cents: number
  duration_min: number | null
  /**
   * Image #104: мастер per-услуга. Например, маникюр у Оли, брови у Алины.
   * Если null — для submit считаем что мастер не выбран (валидация
   * `linesNeedStaff` ниже).
   */
  staff_id: string | null
}

/**
 * Доп. продажа товара/услуги в рамках визита. Может быть из inventory
 * (выбрана позиция со склада — цена подтягивается) или вручную (ввели
 * название + сумму). Мастер по умолчанию = мастер первой услуги визита,
 * но можно изменить — тому начисляется % от продажи (по настройкам).
 *
 * На submit каждая addon-line становится отдельным retail-визитом с
 * group_key привязанным к основному визиту (используем существующий
 * механизм retail+group_key как в RetailSaleWizard).
 */
type AddonLine = {
  uid: string
  inventory_item_id: string | null
  name: string
  qty: number
  unit_price_cents: number
  staff_id: string | null
}

type FormValues = {
  visit_date: string // YYYY-MM-DD
  start_time: string // HH:MM
  end_time: string // HH:MM
  client_id: string | null
  comment: string
}

const schema = z.object({
  visit_date: z.string().min(1, 'visits.errors.date_required'),
  start_time: z.string().min(1, 'visits.errors.start_time_required'),
  end_time: z.string().min(1, 'visits.errors.end_time_required'),
  // Клиент опционален (image #74): запись «без клиента» бывает нужна для
  // блокировки слота под условного клиента, который ещё не зарегистрирован.
  client_id: z.string().nullable().optional().default(null),
  comment: z.string().max(500).optional().default(''),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  /**
   * Префилл из календаря: subslot/drag-select задаёт staff/date/time.
   * `endAt` (опционально) — если drag-select захватил диапазон, то это
   * желаемое время конца; используем как fallback пока юзер не выбрал услуги.
   */
  prefill?: { staffId: string; when: string; clientId?: string; endAt?: string } | null
  /**
   * Image #87: режим редактирования существующего визита. Если задан —
   * форма префиллится данными визита, на submit выполняется UPDATE
   * (одна row, без создания N новых), footer показывает «Удалить» +
   * «Рассчитать» вместо «Сохранить визит».
   *
   * Не поддерживает редактирование multi-line групп (group_key != null) —
   * для них VisitsCalendarView роутит клик в VisitDetailModal как раньше.
   */
  editVisit?: VisitRow | null
  /**
   * Колбэк после успешного сохранения в edit-mode когда юзер нажал
   * «Рассчитать». Передаётся visit id; родитель должен открыть
   * VisitDetailModal в ChargeView для этого визита.
   */
  onChargeRequest?: (visitId: string) => void
}

/**
 * QuickEntryModal — единственная форма записи визита (раньше было два таба:
 * «один визит» и «несколько визитов»; bulk-форма удалена по запросу владельца,
 * см. image #66).
 *
 * Особенности:
 *   - Услуги выбираются СПИСКОМ: одна-несколько штук; сумма автосчитается,
 *     end_time = start_time + Σ durations. Если выбрано >1 услуги, на submit
 *     создаются N visits, связанные общим group_key (как retail-wizard).
 *   - Все поля обязательны кроме комментария. Tip/discount могут быть пустыми
 *     (приравниваются к нулю), но не отрицательными.
 *   - Метод оплаты ЗДЕСЬ не спрашиваем — это создаёт визит со статусом
 *     `pending`. Реальный payment_method выбирается в карточке визита при
 *     нажатии «Рассчитать» (см. VisitDetailModal → ChargeView).
 */
export function QuickEntryModal({
  open,
  onOpenChange,
  salonId,
  currency,
  prefill,
  editVisit,
  onChargeRequest,
}: Props) {
  const { t } = useTranslation()
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const createVisit = useCreateVisit(salonId)
  const { hasOpenShift } = useRequireCashShift(salonId)
  const updateVisit = useUpdateVisit(salonId)
  const deleteVisit = useDeleteVisit(salonId)
  const reserveBooksy = useCreateBooksyReservation()
  const restoreVisit = useRestoreVisit(salonId)
  const isEdit = !!editVisit

  const today = useMemo(() => new Date(), [])
  const todayIso = useMemo(() => format(today, 'yyyy-MM-dd'), [today])

  const initialStaff =
    (typeof window !== 'undefined' && window.localStorage.getItem(LAST_STAFF_KEY)) || ''

  const [lines, setLines] = useState<ServiceLine[]>([])
  const [pendingServiceId, setPendingServiceId] = useState<string>('')
  const [addonLines, setAddonLines] = useState<AddonLine[]>([])
  const { data: inventory = [] } = useInventoryItems(salonId)
  /**
   * Отдельный флаг для подсветки пустого списка услуг под форму.
   * react-hook-form не валидирует `lines`, держим вне формы.
   */
  const [linesTouched, setLinesTouched] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      visit_date: todayIso,
      start_time: '10:00',
      end_time: '11:00',
      client_id: null,
      comment: '',
    },
  })

  // Префилл при открытии: либо из editVisit (правка существующего, image #87),
  // либо из календаря (создание нового через subslot/drag-select).
  useEffect(() => {
    if (!open) return
    if (editVisit) {
      // Edit-mode: одна row, восстанавливаем services-line из service_id/snapshot.
      const start = new Date(editVisit.visit_at)
      const dur =
        editVisit.duration_min ??
        (editVisit.service_id
          ? (services.find((s) => s.id === editVisit.service_id)?.default_duration_min ?? 60)
          : 60)
      const end = new Date(start.getTime() + dur * 60_000)
      const svc = editVisit.service_id ? services.find((s) => s.id === editVisit.service_id) : null
      const line: ServiceLine = {
        uid: crypto.randomUUID(),
        service_id: editVisit.service_id ?? '',
        name: svc?.name ?? editVisit.service_name_snapshot ?? '—',
        price_cents: editVisit.amount_cents,
        duration_min: dur,
        staff_id: editVisit.staff_id ?? null,
      }
      form.reset({
        visit_date: format(start, 'yyyy-MM-dd'),
        start_time: format(start, 'HH:mm'),
        end_time: format(end, 'HH:mm'),
        client_id: editVisit.client_id ?? null,
        comment: editVisit.comment ?? '',
      })
      setLines([line])
      setPendingServiceId('')
      setLinesTouched(false)
      setAddonLines([])
      return
    }
    const prefillDate = prefill ? format(new Date(prefill.when), 'yyyy-MM-dd') : todayIso
    const prefillStart = prefill ? format(new Date(prefill.when), 'HH:mm') : '10:00'
    const prefillEnd = prefill?.endAt
      ? format(new Date(prefill.endAt), 'HH:mm')
      : format(
          new Date(new Date(prefill?.when ?? `${todayIso}T10:00`).getTime() + 60 * 60_000),
          'HH:mm',
        )
    form.reset({
      visit_date: prefillDate,
      start_time: prefillStart,
      end_time: prefillEnd,
      client_id: prefill?.clientId ?? null,
      comment: '',
    })
    setLines([])
    setPendingServiceId('')
    setLinesTouched(false)
    setAddonLines([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    editVisit?.id,
    editVisit?.visit_at,
    prefill?.staffId,
    prefill?.when,
    prefill?.endAt,
    prefill?.clientId,
  ])

  // Image #104: дефолт мастера для новой строки — берём (1) staff_id из
  // предыдущей строки (юзер обычно добавляет несколько услуг к одному
  // мастеру), (2) prefill.staffId (если открыли из календаря на конкретном
  // мастере), (3) localStorage last-staff, (4) первого мастера в списке.
  function pickDefaultStaffForNewLine(): string | null {
    const lastInLines = lines[lines.length - 1]?.staff_id
    if (lastInLines) return lastInLines
    if (prefill?.staffId && staff.some((s) => s.id === prefill.staffId)) return prefill.staffId
    if (initialStaff && staff.some((s) => s.id === initialStaff)) return initialStaff
    return staff[0]?.id ?? null
  }

  // Auto-suggest мастера (image #86): когда выбран клиент И первая услуга,
  // смотрим историю — какой мастер чаще всего делал ему именно ЭТУ услугу.
  // Если найден — подставляем на ПЕРВУЮ строку (image #104: мастер per-услуга,
  // глобального больше нет). Перезаписываем только если юзер ещё не выбрал
  // мастера руками для этой строки. Флаг appliedSuggestionFor не даёт
  // зациклиться.
  const watchedClientId = form.watch('client_id')
  // Подтягиваем карточку клиента — для auto-apply discount_percent при сохранении.
  const { data: selectedClient } = useClient(salonId, watchedClientId ?? undefined)
  const firstServiceId = lines[0]?.service_id ?? null
  const { data: suggestedStaffId } = useSuggestedStaffForClientService(
    salonId,
    watchedClientId,
    firstServiceId,
  )
  const [appliedSuggestionFor, setAppliedSuggestionFor] = useState<string | null>(null)
  useEffect(() => {
    if (!suggestedStaffId) return
    if (!watchedClientId || !firstServiceId) return
    if (lines.length === 0) return
    const key = `${watchedClientId}:${firstServiceId}`
    if (appliedSuggestionFor === key) return
    if (!staff.some((s) => s.id === suggestedStaffId)) return
    setLines((prev) => prev.map((l, i) => (i === 0 ? { ...l, staff_id: suggestedStaffId } : l)))
    setAppliedSuggestionFor(key)
  }, [suggestedStaffId, watchedClientId, firstServiceId, staff, appliedSuggestionFor, lines.length])

  // Пересчёт end_time из start_time + Σ длительностей всех выбранных услуг.
  // Если duration_min не задан у каких-то услуг — для них default 60 мин.
  const watchedStartTime = form.watch('start_time')
  useEffect(() => {
    if (lines.length === 0) return
    const totalMin = lines.reduce((sum, l) => sum + (l.duration_min ?? 60), 0)
    const [hh, mm] = (watchedStartTime || '10:00').split(':').map(Number)
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return
    const total = hh! * 60 + mm! + totalMin
    const endHh = Math.floor((total / 60) % 24)
    const endMm = total % 60
    form.setValue(
      'end_time',
      `${String(endHh).padStart(2, '0')}:${String(endMm).padStart(2, '0')}`,
      { shouldValidate: false },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, watchedStartTime])

  // Image #124: addService удалена — услуга добавляется сразу при выборе из
  // dropdown'а (логика инлайнена в onChange SearchableSelect ниже).

  // ===== Helpers для блока «Доп. Продажи» =====
  const firstStaffId = lines[0]?.staff_id ?? null
  function addAddonLine() {
    setAddonLines((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
        inventory_item_id: null,
        name: '',
        qty: 1,
        unit_price_cents: 0,
        staff_id: firstStaffId,
      },
    ])
  }
  function updateAddonLine(uid: string, patch: Partial<AddonLine>) {
    setAddonLines((prev) => prev.map((a) => (a.uid === uid ? { ...a, ...patch } : a)))
  }
  function removeAddonLine(uid: string) {
    setAddonLines((prev) => prev.filter((a) => a.uid !== uid))
  }
  function selectAddonInventory(uid: string, itemId: string) {
    const item = inventory.find((i) => i.id === itemId)
    if (!item) return
    updateAddonLine(uid, {
      inventory_item_id: item.id,
      name: item.name,
      // На складе пока хранится только cost_per_unit_cents (себестоимость).
      // Используем как стартовую цену продажи — пользователь может изменить
      // в поле вручную.
      unit_price_cents: item.cost_per_unit_cents ?? 0,
    })
  }

  function removeLine(uid: string) {
    setLines((prev) => prev.filter((l) => l.uid !== uid))
  }

  /** Меняет мастера у конкретной строки (image #104). */
  function setLineStaff(uid: string, staffId: string) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, staff_id: staffId } : l)))
  }

  /** Перемещает строку вверх/вниз (image #125). Меняет порядок услуг в
   *  списке — порядок влияет на cumulative start/end times каждой строки. */
  function moveLine(uid: string, direction: -1 | 1) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.uid === uid)
      if (idx < 0) return prev
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(newIdx, 0, item!)
      return next
    })
  }

  const totalAmountCents = lines.reduce((s, l) => s + l.price_cents, 0)
  /** Все ли строки имеют выбранного мастера. Используется в валидации
   *  submit и для подсветки строк без мастера. */
  const linesWithoutStaff = lines.filter((l) => !l.staff_id)

  async function onSubmit(values: FormValues, opts?: { thenCharge?: boolean }) {
    if (lines.length === 0) {
      setLinesTouched(true)
      toast.error(t('visits.errors.services_required'))
      return
    }
    // Image #104: мастер обязателен на каждой строке. Если хотя бы одна
    // строка без мастера — submit не идёт, юзер видит подсветку строки.
    if (linesWithoutStaff.length > 0) {
      setLinesTouched(true)
      toast.error(t('visits.errors.staff_required'))
      return
    }

    // Чаевые на этапе создания не вводим (задаются в «Рассчитать»).
    // Скидку — если у клиента стоит discount_percent — авто-применяем от
    // суммы всех строк. Юзер может поменять в карточке визита.
    const tipCentsTotal = 0
    const clientDiscountPct =
      selectedClient?.discount_percent != null && selectedClient.discount_percent > 0
        ? Number(selectedClient.discount_percent)
        : 0
    const discountCentsTotal =
      clientDiscountPct > 0
        ? Math.round((lines.reduce((s, l) => s + l.price_cents, 0) * clientDiscountPct) / 100)
        : 0

    const [yyyy, mm, dd] = values.visit_date.split('-').map(Number)
    const [sh, sm] = values.start_time.split(':').map(Number)
    const visitDate = new Date(yyyy ?? 1970, (mm ?? 1) - 1, dd ?? 1, sh ?? 0, sm ?? 0, 0, 0)
    const visitAt = visitDate.toISOString()

    // Длительность брони — из формы (end-start) либо сумма duration_min услуг.
    const [eh, em] = values.end_time.split(':').map(Number)
    const formDur =
      Number.isFinite(sh) && Number.isFinite(eh) ? eh! * 60 + (em ?? 0) - (sh! * 60 + (sm ?? 0)) : 0
    const totalDurationMin =
      formDur > 0 ? formDur : lines.reduce((s, l) => s + (l.duration_min ?? 60), 0)

    // ── Edit-mode (image #87): UPDATE одной row, без conflict-detection
    // (юзер уже видит конфликты на календаре). После save callback на charge.
    if (isEdit && editVisit) {
      const firstLine = lines[0]!
      const newDur = lines.length === 1 && formDur > 0 ? formDur : (firstLine.duration_min ?? 60)
      try {
        await updateVisit.mutateAsync({
          id: editVisit.id,
          staff_id: firstLine.staff_id,
          client_id: values.client_id || null,
          service_id: firstLine.service_id || null,
          service_name_snapshot: firstLine.name,
          visit_at: visitAt,
          amount_cents: firstLine.price_cents,
          comment: values.comment || null,
          duration_min: newDur,
        })
        toast.success(t('visits.toast_updated'))
        if (opts?.thenCharge) {
          onChargeRequest?.(editVisit.id)
        } else {
          onOpenChange(false)
        }
      } catch (err) {
        toast.error(t('visits.toast_error'), {
          description: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }

    // Conflict-detection — image #104: проверяем перекрытие для каждого
    // уникального мастера, который участвует в визите. Юзер подтверждает
    // или отменяет один раз (первый найденный конфликт).
    const newStartMs = visitDate.getTime()
    const newEndMs = newStartMs + totalDurationMin * 60_000
    const uniqueStaffIds = Array.from(
      new Set(lines.map((l) => l.staff_id).filter((s): s is string => !!s)),
    )
    const dayStart = new Date(visitDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    for (const staffId of uniqueStaffIds) {
      const { data: sameDayVisits } = await supabase
        .from('visits')
        .select('id, visit_at, service_id, service_name_snapshot, payment_method, status')
        .eq('salon_id', salonId)
        .eq('staff_id', staffId)
        .is('deleted_at', null)
        .gte('visit_at', dayStart.toISOString())
        .lt('visit_at', dayEnd.toISOString())
      const conflict = (sameDayVisits ?? []).find(
        (v: { visit_at: string; service_id: string | null }) => {
          const existStart = new Date(v.visit_at).getTime()
          const existSvc = v.service_id ? services.find((s) => s.id === v.service_id) : null
          const existDur = (existSvc?.default_duration_min ?? 60) * 60_000
          const existEnd = existStart + existDur
          return existStart < newEndMs && existEnd > newStartMs
        },
      )
      if (conflict) {
        const c = conflict as {
          id: string
          visit_at: string
          service_id: string | null
          service_name_snapshot: string | null
        }
        const conflictTime = new Date(c.visit_at).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })
        const conflictSvc = c.service_id
          ? (services.find((s) => s.id === c.service_id)?.name ?? c.service_name_snapshot ?? '—')
          : (c.service_name_snapshot ?? '—')
        const ok = window.confirm(
          t('visits.errors.conflict', { time: conflictTime, service: conflictSvc }),
        )
        if (!ok) return
        break
      }
    }

    // Метод оплаты на этом шаге не выбирается — реальный выбор будет в
    // VisitDetailModal → «Рассчитать». Сохраняем дефолт (последний
    // использованный либо 'card'), чтобы прошли NOT NULL constraint.
    const defaultPayment =
      (typeof window !== 'undefined' && window.localStorage.getItem(LAST_PAYMENT_KEY)) || 'card'

    // Создаём N visits — по одной строке на услугу. Связываем общим
    // group_key, если услуг >1, чтобы UI и charge-flow видели группу.
    const groupKey = lines.length > 1 ? crypto.randomUUID() : null
    const createdIds: string[] = []
    try {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!
        const firstLine = i === 0
        const lineDuration = lines.length === 1 && formDur > 0 ? formDur : (l.duration_min ?? 60)
        const created = await createVisit.mutateAsync({
          salon_id: salonId,
          // Image #104: мастер у каждой строки свой.
          staff_id: l.staff_id,
          client_id: values.client_id || null,
          service_id: l.service_id,
          service_name_snapshot: l.name,
          visit_at: visitAt,
          amount_cents: l.price_cents,
          tip_cents: firstLine ? tipCentsTotal : 0,
          discount_cents: firstLine ? discountCentsTotal : 0,
          payment_method: defaultPayment as 'cash' | 'card' | 'transfer' | 'online' | 'mixed',
          comment: firstLine ? values.comment || null : null,
          status: 'pending',
          group_key: groupKey,
          duration_min: lineDuration,
        })
        createdIds.push(created.id)
      }

      // Доп. Продажи — создаём retail-визиты, связанные group_key'ом с
      // основным визитом. Используем существующий механизм retail (как в
      // RetailSaleWizard). Списываем со склада через inventory_apply_tx.
      const addonGroupKey = groupKey ?? createdIds[0] ?? null
      for (const a of addonLines) {
        const validQty = Math.max(1, Math.round(a.qty))
        const total = validQty * a.unit_price_cents
        if (total <= 0 || !a.name.trim()) continue
        const retailVisit = await createVisit.mutateAsync({
          salon_id: salonId,
          staff_id: a.staff_id ?? lines[0]?.staff_id ?? null,
          client_id: values.client_id || null,
          service_id: null,
          service_name_snapshot: validQty > 1 ? `${a.name.trim()} ×${validQty}` : a.name.trim(),
          visit_at: visitAt,
          amount_cents: total,
          tip_cents: 0,
          discount_cents: 0,
          payment_method: defaultPayment as 'cash' | 'card' | 'transfer' | 'online' | 'mixed',
          comment: null,
          kind: 'retail',
          status: 'pending',
          group_key: addonGroupKey,
          inventory_item_id: a.inventory_item_id,
        })
        createdIds.push(retailVisit.id)
        // Списание со склада только для inventory-позиций.
        if (a.inventory_item_id && validQty > 0) {
          const { error: invErr } = await supabase.rpc('inventory_apply_tx', {
            p_material_id: a.inventory_item_id,
            p_type: 'manual_adjustment',
            p_quantity: -validQty,
            p_cost_cents: null,
            p_notes: `Доп. продажа в визите`,
          })
          if (invErr) {
            console.warn('inventory_apply_tx failed', invErr)
            toast.error(`Склад: ${invErr.message}`)
          }
        }
      }

      // Запоминаем мастера ПЕРВОЙ строки как last-staff (используем как
      // дефолт для следующей записи).
      const firstStaff = lines[0]?.staff_id
      if (firstStaff) window.localStorage.setItem(LAST_STAFF_KEY, firstStaff)

      const firstStf = staff.find((s) => s.id === firstStaff)
      toast.success(t('visits.toast_added'), {
        description: `${firstStf?.full_name ?? ''} · ${formatCurrency(
          totalAmountCents - discountCentsTotal + tipCentsTotal,
          currency,
        )}`,
        action: {
          label: t('visits.toast_undo'),
          onClick: () => {
            for (const id of createdIds) {
              deleteVisit.mutate(id, {
                onSuccess: () => {
                  toast(t('visits.toast_undone'), {
                    action: {
                      label: t('visits.toast_restore'),
                      onClick: () => restoreVisit.mutate(id),
                    },
                  })
                },
              })
            }
          },
        },
      })

      // Booksy reverse-sync — резервируем слот для каждого УНИКАЛЬНОГО
      // мастера на длительность всей записи (несколько услуг у разных
      // мастеров → несколько reservation-объектов в Booksy).
      const booksyConnected = integrations.some(
        (i) => i.provider === 'booksy' && i.status === 'connected',
      )
      if (booksyConnected && totalDurationMin > 0) {
        const startAt = new Date(visitAt)
        const endAt = new Date(startAt.getTime() + totalDurationMin * 60000)
        // Map: staff_id → первый visit_id для этого мастера. Нужно чтобы
        // booksy-proxy записал reservation_id в visits.external_reservation_id,
        // и при удалении визита в портале можно было снять парный блок в Booksy.
        const staffToVisitId = new Map<string, string>()
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]!
          const vid = createdIds[i]
          if (l.staff_id && vid && !staffToVisitId.has(l.staff_id)) {
            staffToVisitId.set(l.staff_id, vid)
          }
        }
        let reservedCount = 0
        let skippedNoExternal = 0
        for (const staffId of uniqueStaffIds) {
          const stf = staff.find((s) => s.id === staffId)
          const stfExternal =
            stf?.external_source === 'booksy' && stf.external_id ? stf.external_id : null
          if (!stfExternal) {
            skippedNoExternal++
            console.warn(
              `Booksy reservation skipped: staff ${stf?.full_name ?? staffId} has no external_id (not linked to Booksy)`,
            )
            continue
          }
          reserveBooksy.mutate({
            salonId,
            staffIdExternal: stfExternal,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            title: lines
              .filter((ln) => ln.staff_id === staffId)
              .map((ln) => ln.name)
              .join(', '),
            visitId: staffToVisitId.get(staffId) ?? null,
          })
          reservedCount++
        }
        // Warning если ни одной резервации не сделали — частая причина
        // у юзера: мастер вручную создан в портале (без Booksy external_id)
        if (reservedCount === 0 && skippedNoExternal > 0) {
          toast.warning(t('visits.toast_booksy_skip_no_external'), {
            description: t('visits.toast_booksy_skip_no_external_hint'),
          })
        }
      }

      onOpenChange(false)
    } catch (err) {
      toast.error(t('visits.toast_error'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Image #104: палитра кружков-аватарок мастеров для рендера в строке услуги.
  function staffAvatar(staffId: string | null): { color: string; initial: string } {
    if (!staffId) return { color: '#E8E5DF', initial: '?' }
    const idx = staff.findIndex((s) => s.id === staffId)
    const color = idx >= 0 ? STAFF_PALETTE[idx % STAFF_PALETTE.length]! : '#E8E5DF'
    const initial =
      staff
        .find((s) => s.id === staffId)
        ?.full_name.charAt(0)
        .toUpperCase() ?? '?'
    return { color, initial }
  }

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency
  const linesError = linesTouched && lines.length === 0
  const lineStaffError = linesTouched && linesWithoutStaff.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!w-[640px] sm:!max-w-[640px]">
        {/* Image #76: чтобы модалка влазила без скролла на типичном
            desktop-разрешении, убрал DialogDescription («Запишется в книгу...»),
            сжал form-gap до gap-2 и pt-2 → pt-1. Сама форма всё ещё
            overflow-y-auto — на ноутбучных экранах <800px она схлопнется
            корректно, но в обычном кейсе скролла не будет. */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{isEdit ? t('visits.form.title_edit') : t('visits.form.title_new')}</span>
            {isEdit && editVisit ? <StatusBadge status={editVisit.status} /> : null}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-2 overflow-y-auto px-5 pb-2 pt-1"
          onSubmit={form.handleSubmit((v) => onSubmit(v))}
          noValidate
        >
          {/* Клиент — самый верх (image #68). Опциональное поле (image #74):
              запись «без клиента» допустима — например, чтобы заранее
              забронировать слот под клиента, которого ещё не вносили в базу. */}
          <Controller
            name="client_id"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-client">{t('visits.form.client_label')}</Label>
                <ClientPicker
                  salonId={salonId}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  placeholder={t('clients.picker.no_client')}
                  testId="qe-client"
                />
              </div>
            )}
          />

          {/* Услуги — после клиента. Можно добавить несколько.
              Image #124: убрали кнопку «Добавить» — после выбора услуги из
              dropdown'а она сразу добавляется в список (один клик вместо
              двух). Селект очищается, юзер может выбрать следующую. */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('visits.form.service_label')} *</Label>
            <div className="min-w-0">
              <SearchableSelect
                value={pendingServiceId}
                onChange={(v) => {
                  if (!v) {
                    setPendingServiceId('')
                    return
                  }
                  // Авто-добавление: ставим pending → сразу добавляем линию →
                  // очищаем (addService использует pendingServiceId).
                  setPendingServiceId(v)
                  const svc = services.find((s) => s.id === v)
                  if (!svc) return
                  const defaultStaff = pickDefaultStaffForNewLine()
                  setLines((prev) => [
                    ...prev,
                    {
                      uid: crypto.randomUUID(),
                      service_id: svc.id,
                      name: svc.name,
                      price_cents: svc.default_price_cents,
                      duration_min: svc.default_duration_min,
                      staff_id: defaultStaff,
                    },
                  ])
                  setPendingServiceId('')
                  setLinesTouched(true)
                }}
                disabled={services.length === 0}
                options={services.map((s) => ({
                  value: s.id,
                  label: s.name,
                  hint: `≈ ${formatCurrency(s.default_price_cents, currency)}${
                    s.default_duration_min ? ` · ${s.default_duration_min} ${t('common.min')}` : ''
                  }`,
                }))}
                placeholder={
                  services.length === 0
                    ? t('visits.form.service_empty')
                    : t('visits.form.service_placeholder')
                }
                searchPlaceholder={t('visits.filters.search_services')}
                emptyText={t('common.no_results')}
                ariaLabel={t('visits.form.service_label')}
              />
            </div>
            {services.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t('visits.form.service_empty_hint')}{' '}
                <a
                  href={`/salon/${salonId}/services`}
                  className="text-primary font-semibold hover:underline"
                >
                  {t('visits.form.service_empty_link')}
                </a>
              </p>
            ) : null}

            {/* Список выбранных услуг. Image #104: рядом с каждой услугой —
                свой селектор мастера. Image #125: дополнительно показываем
                время начала/конца этой услуги (computed) и стрелки для
                реордера строк. Подсветка красной рамкой если строка без
                мастера и юзер уже пытался сохранить. */}
            {lines.length > 0 ? (
              <ul className="border-border bg-card divide-border/60 mt-1 flex flex-col divide-y rounded-md border">
                {lines.map((l, lineIdx) => {
                  const av = staffAvatar(l.staff_id)
                  const missingStaff = lineStaffError && !l.staff_id
                  // Image #125: cumulative start/end. Старт первой строки =
                  // form.start_time, далее каждая следующая стартует там же,
                  // где закончилась предыдущая. Длительность по-умолчанию 60.
                  const baseStart = form.watch('start_time') || '10:00'
                  const [bh, bm] = baseStart.split(':').map(Number)
                  const baseMin = (bh ?? 10) * 60 + (bm ?? 0)
                  const cumBefore = lines
                    .slice(0, lineIdx)
                    .reduce((s, ln) => s + (ln.duration_min ?? 60), 0)
                  const lineStartMin = baseMin + cumBefore
                  const lineEndMin = lineStartMin + (l.duration_min ?? 60)
                  const fmtTime = (m: number) => {
                    const hh = Math.floor((m / 60) % 24)
                    const mm = m % 60
                    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
                  }
                  return (
                    <li
                      key={l.uid}
                      className={cn(
                        'flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center',
                        missingStaff && 'bg-destructive/5',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-semibold">{l.name}</p>
                        <p className="text-muted-foreground text-[11px]">
                          {/* Image #125: время начала и конца услуги. */}
                          <span className="num text-secondary font-semibold">
                            {fmtTime(lineStartMin)} — {fmtTime(lineEndMin)}
                          </span>
                          {' · '}
                          <span className="num">
                            {l.duration_min
                              ? `${l.duration_min} ${t('common.min')}`
                              : `60 ${t('common.min')} (${t('visits.form.duration_default')})`}
                          </span>
                          {' · '}
                          <span className="num">{formatCurrency(l.price_cents, currency)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {/* Image #125: стрелки реордера. Disabled на крайних строках. */}
                        <button
                          type="button"
                          onClick={() => moveLine(l.uid, -1)}
                          disabled={lineIdx === 0}
                          aria-label={t('visits.form.move_up', { defaultValue: 'Вверх' })}
                          className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowUp className="size-3.5" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveLine(l.uid, 1)}
                          disabled={lineIdx === lines.length - 1}
                          aria-label={t('visits.form.move_down', { defaultValue: 'Вниз' })}
                          className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowDown className="size-3.5" strokeWidth={1.8} />
                        </button>
                        <Select
                          value={l.staff_id ?? ''}
                          onValueChange={(v) => setLineStaff(l.uid, v)}
                        >
                          <SelectTrigger
                            data-testid="qe-line-staff"
                            className={cn(
                              'h-9 w-[180px] text-sm',
                              missingStaff && 'border-destructive',
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className="text-brand-navy grid size-5 place-items-center rounded-full text-[10px] font-bold"
                                style={{ background: av.color }}
                              >
                                {av.initial}
                              </span>
                              <SelectValue placeholder={t('visits.form.staff_placeholder')} />
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {staff.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          onClick={() => removeLine(l.uid)}
                          aria-label={t('common.remove')}
                          className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.8} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {linesError ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t('visits.errors.services_required')}
              </p>
            ) : null}
            {lineStaffError ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t('visits.errors.staff_required')}
              </p>
            ) : null}
          </div>

          {/* Image #104: глобальный селектор мастера удалён — выбор теперь
              рядом с каждой услугой в списке выше. */}

          {/* Доп. Продажи: товар со склада или ручной ввод. Каждая строка
              станет отдельным retail-визитом с group_key привязанным к
              основному. Мастер по умолчанию = мастер первой услуги, но
              можно изменить — тому начисляется % от продажи. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>{t('visits.form.addon_sales_label')}</Label>
              <button
                type="button"
                onClick={addAddonLine}
                className="text-secondary text-xs font-semibold hover:underline"
                data-testid="qe-addon-add"
              >
                + {t('visits.form.addon_add')}
              </button>
            </div>
            {addonLines.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t('visits.form.addon_empty')}</p>
            ) : (
              <ul className="border-border bg-card divide-border/60 flex flex-col divide-y rounded-md border">
                {addonLines.map((a) => {
                  const stock = a.inventory_item_id
                    ? inventory.find((i) => i.id === a.inventory_item_id)
                    : null
                  const av = staffAvatar(a.staff_id)
                  // Если inventory_item_id ещё не выбран — показываем select для выбора.
                  // Иначе — компактная карточка как у услуг.
                  if (!a.inventory_item_id && !a.name) {
                    return (
                      <li key={a.uid} className="flex items-center gap-2 px-3 py-2">
                        <div className="flex-1">
                          <SearchableSelect
                            value={a.inventory_item_id ?? ''}
                            options={[
                              ...inventory.map((it) => ({
                                value: it.id,
                                label: it.name,
                                subLabel: formatCurrency(it.cost_per_unit_cents ?? 0, currency),
                              })),
                            ]}
                            onChange={(v) => {
                              if (v) selectAddonInventory(a.uid, v)
                            }}
                            placeholder={t('visits.form.addon_inventory_placeholder')}
                            searchPlaceholder={t('visits.form.addon_search')}
                          />
                          <Input
                            value={a.name}
                            onChange={(e) => updateAddonLine(a.uid, { name: e.target.value })}
                            placeholder={t('visits.form.addon_manual_name')}
                            className="mt-1.5 h-9 text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAddonLine(a.uid)}
                          aria-label={t('common.remove')}
                          className="text-muted-foreground hover:text-destructive grid size-7 shrink-0 place-items-center rounded-md"
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.8} />
                        </button>
                      </li>
                    )
                  }
                  return (
                    <li
                      key={a.uid}
                      className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-semibold">{a.name}</p>
                        <p className="text-muted-foreground text-[11px]">
                          <span className="num">
                            {a.qty} × {formatCurrency(a.unit_price_cents, currency)}
                          </span>
                          {' · '}
                          <span className="num text-foreground font-bold">
                            {formatCurrency(a.qty * a.unit_price_cents, currency)}
                          </span>
                          {stock ? (
                            <>
                              {' · '}
                              <span className="text-muted-foreground/70">
                                {t('visits.form.addon_stock_left', {
                                  qty: stock.current_stock,
                                  unit: stock.unit ?? '',
                                })}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Input
                          type="number"
                          min={1}
                          value={a.qty}
                          onChange={(e) =>
                            updateAddonLine(a.uid, {
                              qty: Math.max(1, Math.round(Number(e.target.value) || 1)),
                            })
                          }
                          aria-label={t('visits.form.addon_qty')}
                          className="num h-9 w-16 shrink-0 text-center text-sm"
                        />
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={(a.unit_price_cents / 100).toFixed(2)}
                          onChange={(e) =>
                            updateAddonLine(a.uid, {
                              unit_price_cents: Math.round(
                                (parseFloat(e.target.value.replace(',', '.')) || 0) * 100,
                              ),
                            })
                          }
                          aria-label={t('visits.form.addon_price')}
                          className="num h-9 w-20 shrink-0 text-sm"
                        />
                        <Select
                          value={a.staff_id ?? ''}
                          onValueChange={(v) => updateAddonLine(a.uid, { staff_id: v })}
                        >
                          <SelectTrigger className="h-9 min-w-0 flex-1 text-sm sm:w-[160px] sm:flex-none">
                            <span className="flex items-center gap-2">
                              <span
                                className="text-brand-navy grid size-5 place-items-center rounded-full text-[10px] font-bold"
                                style={{ background: av.color }}
                              >
                                {av.initial}
                              </span>
                              <SelectValue placeholder={t('visits.form.staff_placeholder')} />
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {staff.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          onClick={() => removeAddonLine(a.uid)}
                          aria-label={t('common.remove')}
                          className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.8} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Дата + Время от/до */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qe-date">{t('visits.form.date_label')} *</Label>
              <div className="border-border bg-card flex h-11 items-center gap-2 rounded-md border-[1.5px] px-3">
                <CalendarDays className="text-muted-foreground size-[17px]" strokeWidth={1.7} />
                <input
                  id="qe-date"
                  type="date"
                  data-testid="qe-date"
                  {...form.register('visit_date')}
                  className="num text-foreground h-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                />
                {form.watch('visit_date') === todayIso ? (
                  <span className="bg-brand-sage-soft text-brand-sage rounded-full px-2 py-0.5 text-[11px] font-bold">
                    {t('visits.form.today_pill')}
                  </span>
                ) : null}
              </div>
              {form.formState.errors.visit_date ? (
                <p className="text-destructive text-xs font-medium" role="alert">
                  {t(form.formState.errors.visit_date.message ?? '')}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qe-start-time">{t('visits.form.start_time_label')} *</Label>
              <input
                id="qe-start-time"
                type="time"
                data-testid="qe-start-time"
                {...form.register('start_time')}
                className="num text-foreground border-border bg-card h-11 w-[110px] rounded-md border-[1.5px] px-3 text-sm font-medium outline-none"
              />
              {form.formState.errors.start_time ? (
                <p className="text-destructive text-xs font-medium" role="alert">
                  {t(form.formState.errors.start_time.message ?? '')}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qe-end-time">{t('visits.form.end_time_label')} *</Label>
              <input
                id="qe-end-time"
                type="time"
                data-testid="qe-end-time"
                {...form.register('end_time')}
                className="num text-foreground border-border bg-card h-11 w-[110px] rounded-md border-[1.5px] px-3 text-sm font-medium outline-none"
              />
              {form.formState.errors.end_time ? (
                <p className="text-destructive text-xs font-medium" role="alert">
                  {t(form.formState.errors.end_time.message ?? '')}
                </p>
              ) : null}
            </div>
          </div>

          {/* Сумма — автоматически из суммы услуг (read-only).
              Image #126: «PLN» и цифра расходились вертикально (одна выше
              другой). Виноват был h-full + self-center на span'е с цифрой —
              у него получалась другая baseline. Решение: items-baseline на
              контейнере + убрать h-full/self-center у цифры. Теперь оба
              текста стоят на одной базовой линии. */}
          <div className="flex flex-col gap-1">
            <Label>{t('visits.form.amount_label')}</Label>
            <div className="border-brand-yellow-deep bg-brand-yellow flex h-14 items-baseline gap-2 rounded-md border-[1.5px] px-4 py-3">
              <span className="num text-brand-navy text-2xl font-bold leading-none">
                {currencySymbol}
              </span>
              <span
                className={cn(
                  'num text-brand-navy min-w-0 flex-1 text-2xl font-bold leading-none tracking-tight',
                  totalAmountCents === 0 && 'text-brand-navy/30',
                )}
                data-testid="qe-amount-display"
              >
                {(totalAmountCents / 100).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Чаевые и скидка на создании визита больше не показываются
              (image #69) — они задаются при нажатии «Рассчитать» в
              VisitDetailModal → ChargeView, когда визит реально оплачивается.
              Исключение: если у клиента в карточке стоит discount_percent > 0
              — показываем подсказку, что скидка автоприменится при сохранении. */}
          {selectedClient?.discount_percent != null &&
          Number(selectedClient.discount_percent) > 0 &&
          totalAmountCents > 0 ? (
            <div className="border-brand-yellow/40 bg-brand-yellow/10 flex items-baseline justify-between gap-2 rounded-md border px-3 py-2 text-xs">
              <span className="text-foreground/80">
                {t('visits.form.client_discount_hint', {
                  pct: Number(selectedClient.discount_percent),
                })}
              </span>
              <span className="num text-foreground font-semibold">
                −{currencySymbol}
                {(
                  Math.round((totalAmountCents * Number(selectedClient.discount_percent)) / 100) /
                  100
                ).toFixed(2)}
              </span>
            </div>
          ) : null}

          {/* Комментарий — единственное необязательное поле */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qe-comment">{t('visits.form.comment_label')}</Label>
            <Input
              id="qe-comment"
              placeholder={t('visits.form.comment_placeholder')}
              {...form.register('comment')}
            />
          </div>
        </form>

        <DialogFooter className={isEdit ? 'sm:justify-between' : undefined}>
          {isEdit && editVisit ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={deleteVisit.isPending}
                onClick={() => {
                  if (!window.confirm(t('visits.confirm_delete'))) return
                  deleteVisit.mutate(editVisit.id, {
                    onSuccess: () => {
                      toast.success(t('visits.toast_deleted'))
                      onOpenChange(false)
                    },
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }}
                className="text-destructive hover:bg-destructive/10"
              >
                {t('common.delete')}
              </Button>
              {editVisit?.status === 'paid' ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setReceiptOpen(true)}
                  data-testid="qe-receipt"
                >
                  {t('visits.form.show_receipt')}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  onClick={() => {
                    // Per-user касса: гейт ДО открытия ChargeView.
                    if (!hasOpenShift) {
                      setGateOpen(true)
                      return
                    }
                    void form.handleSubmit((v) => onSubmit(v, { thenCharge: true }))()
                  }}
                  disabled={updateVisit.isPending || deleteVisit.isPending}
                  data-testid="qe-charge"
                >
                  {updateVisit.isPending ? t('common.loading') : t('visits.detail.charge')}
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              size="lg"
              onClick={form.handleSubmit((v) => onSubmit(v))}
              disabled={createVisit.isPending}
              data-testid="qe-submit"
            >
              {createVisit.isPending ? t('common.loading') : t('visits.form.submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      <CashGateRequiredDialog
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        salonId={salonId}
        action="visit_charge"
        onShiftOpened={() => void form.handleSubmit((v) => onSubmit(v, { thenCharge: true }))()}
      />
      <VisitReceiptModal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        salonId={salonId}
        visit={editVisit ?? null}
      />
    </Dialog>
  )
}

function StatusBadge({ status }: { status: 'paid' | 'pending' | 'cancelled' }) {
  const { t } = useTranslation()
  const cls =
    status === 'paid'
      ? 'bg-brand-sage-soft text-brand-sage-deep'
      : status === 'cancelled'
        ? 'bg-red-100 text-red-700'
        : 'bg-amber-100 text-amber-800'
  return (
    <span
      className={`${cls} rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider`}
    >
      {t(`visits.status.${status}`)}
    </span>
  )
}
