import { ArrowLeftRight, ArrowRight, Loader2, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCashRegisters } from '@/hooks/useCashRegisters'
import {
  useCashTransfers,
  useSoftDeleteCashTransfer,
  useUpdateCashTransfer,
  type CashTransfer,
} from '@/hooks/useCashTransfers'
import { useSalon, useSalonMembership } from '@/hooks/useSalons'
import { useTeamMembers } from '@/hooks/useTeam'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatVisitDate } from '@/lib/utils/format-date'
import { CashTransferModal } from '@/routes/expenses/CashTransferModal'

/**
 * Финансы → Перестановка средств. Полная история переводов между кассами
 * с фильтрами и кнопкой открытия модалки создания (см. ADR-014).
 *
 * История раньше жила внутри CashTransferModal как сворачиваемая секция —
 * перенесли сюда, чтобы:
 *   - таблица не сжимала форму перевода
 *   - можно было полноценно фильтровать (Откуда/Куда отдельно, сумма-диапазон)
 *   - запись и просмотр истории — две разные задачи, делим по табам
 */
export function TransfersTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('cash_transfer.tab_title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm">{t('cash_transfer.tab_subtitle')}</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>
          <ArrowLeftRight className="size-4" strokeWidth={2} />
          {t('cash_transfer.button_new')}
        </Button>
      </div>

      <TransfersHistoryBlock salonId={salonId} currency={currency} />

      <CashTransferModal open={modalOpen} onClose={() => setModalOpen(false)} salonId={salonId} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Блок истории с фильтрами + drawer'ом деталей
// ────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

function TransfersHistoryBlock({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const [fromFilter, setFromFilter] = useState<string>('')
  const [toFilter, setToFilter] = useState<string>('')
  const [userFilter, setUserFilter] = useState<string>('')
  const [minAmount, setMinAmount] = useState<string>('')
  const [maxAmount, setMaxAmount] = useState<string>('')
  const [page, setPage] = useState(1)
  const [drawer, setDrawer] = useState<CashTransfer | null>(null)

  const { data: registers = [] } = useCashRegisters(salonId, { includeSystem: true })
  const { data: teamMembers = [] } = useTeamMembers(salonId)
  const labelById = useMemo(() => new Map(registers.map((r) => [r.id, r.label])), [registers])
  const userNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of teamMembers) {
      if (x.user_id) m.set(x.user_id, x.full_name || x.email || '—')
    }
    return m
  }, [teamMembers])

  // Сброс пагинации при смене любого фильтра.
  useEffect(() => {
    setPage(1)
  }, [period, fromFilter, toFilter, userFilter, minAmount, maxAmount])

  // ВАЖНО: для `kind: 'recent'` `periodToRange` возвращает `new Date()` —
  // новые объекты каждый рендер → query key churns → React Query infinite
  // refetch loop. Memo по `period` стабилизирует диапазон.
  const range = useMemo(() => periodToRange(period), [period])
  const minCents = minAmount ? Math.round(Number(minAmount.replace(',', '.')) * 100) : null
  const maxCents = maxAmount ? Math.round(Number(maxAmount.replace(',', '.')) * 100) : null

  const { data: pageData, isLoading } = useCashTransfers(
    salonId,
    {
      start: range.start,
      end: range.end,
      fromRegisterId: fromFilter || null,
      toRegisterId: toFilter || null,
      userId: userFilter || null,
      minAmountCents: Number.isFinite(minCents) && minCents !== null ? minCents : null,
      maxAmountCents: Number.isFinite(maxCents) && maxCents !== null ? maxCents : null,
    },
    page,
    PAGE_SIZE,
  )

  const rows = pageData?.rows ?? []
  const total = pageData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function resetFilters() {
    setPeriod(currentMonthPeriod())
    setFromFilter('')
    setToFilter('')
    setUserFilter('')
    setMinAmount('')
    setMaxAmount('')
  }

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border">
      <div className="border-border border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={fromFilter || 'all'}
            onValueChange={(v) => setFromFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="h-10 w-[200px]">
              <SelectValue placeholder={t('cash_transfer.filter_from')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('cash_transfer.filter_from_all')}</SelectItem>
              {registers.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={toFilter || 'all'}
            onValueChange={(v) => setToFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="h-10 w-[200px]">
              <SelectValue placeholder={t('cash_transfer.filter_to')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('cash_transfer.filter_to_all')}</SelectItem>
              {registers.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={userFilter || 'all'}
            onValueChange={(v) => setUserFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="h-10 w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('cash_transfer.filter_all_users')}</SelectItem>
              {teamMembers
                .filter((m) => m.user_id)
                .map((m) => (
                  <SelectItem key={m.user_id ?? ''} value={m.user_id ?? ''}>
                    {m.full_name || m.email}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Input
              type="text"
              inputMode="decimal"
              placeholder={t('cash_transfer.filter_amount_min')}
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              className="h-10 w-[110px]"
            />
            <span className="text-muted-foreground text-xs">—</span>
            <Input
              type="text"
              inputMode="decimal"
              placeholder={t('cash_transfer.filter_amount_max')}
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              className="h-10 w-[110px]"
            />
          </div>
          {fromFilter || toFilter || userFilter || minAmount || maxAmount ? (
            <Button variant="ghost" size="md" onClick={resetFilters}>
              {t('cash_transfer.filter_reset')}
            </Button>
          ) : null}
          <div className="ml-auto">
            <PeriodPickerPopover value={period} onChange={setPeriod} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-6">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground p-6 text-sm">{t('cash_transfer.history_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">{t('cash_transfer.col_date')}</th>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('cash_transfer.col_route')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('cash_transfer.col_amount')}
                </th>
                <th className="px-4 py-2 text-left font-semibold">{t('cash_transfer.col_who')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <TransferRow
                  key={r.id}
                  row={r}
                  labelById={labelById}
                  userNameById={userNameById}
                  currency={currency}
                  salonId={salonId}
                  onOpenDetail={() => setDrawer(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="border-border flex items-center justify-between gap-2 border-t px-4 py-3">
          <p className="text-muted-foreground text-xs">
            {(page - 1) * PAGE_SIZE + 1}—{Math.min(page * PAGE_SIZE, total)} {t('common.of')}{' '}
            {total}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-8 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
            >
              ‹
            </button>
            <span className="text-muted-foreground px-2 text-xs">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-8 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

      <TransferDetailDrawer
        transfer={drawer}
        onClose={() => setDrawer(null)}
        salonId={salonId}
        labelById={labelById}
        userNameById={userNameById}
        currency={currency}
      />
    </div>
  )
}

function TransferRow({
  row,
  labelById,
  userNameById,
  currency,
  salonId,
  onOpenDetail,
}: {
  row: CashTransfer
  labelById: Map<string, string>
  userNameById: Map<string, string>
  currency: string
  salonId: string
  onOpenDetail: () => void
}) {
  const { t } = useTranslation()
  const { data: membership } = useSalonMembership(salonId)
  const canDelete = membership?.role === 'owner' || membership?.role === 'admin'
  const softDelete = useSoftDeleteCashTransfer(salonId)

  const fromLabel =
    labelById.get(row.from_register_id) ?? `(${t('cash_transfer.removed_register')})`
  const toLabel = labelById.get(row.to_register_id) ?? `(${t('cash_transfer.removed_register')})`
  const who = row.created_by ? (userNameById.get(row.created_by) ?? '—') : '—'
  const isDeleted = row.deleted_at !== null
  const isReversal = row.reversal_of !== null

  async function handleDelete() {
    const reason = window.prompt(t('cash_transfer.delete_prompt'))
    if (!reason || !reason.trim()) return
    try {
      await softDelete.mutateAsync({ id: row.id, reason: reason.trim() })
      toast.success(t('cash_transfer.toast_deleted'))
    } catch (e) {
      toast.error(describeRpcError(e))
    }
  }

  return (
    <tr
      className={`border-border/60 cursor-pointer border-t ${
        isDeleted ? 'opacity-50' : 'hover:bg-muted/30'
      }`}
      onClick={onOpenDetail}
    >
      <td className="text-muted-foreground num px-4 py-3 text-xs">
        {formatVisitDate(row.transferred_at)}
      </td>
      <td className="text-foreground px-4 py-3 text-xs">
        <span className="font-semibold">{fromLabel}</span>
        <ArrowRight className="text-muted-foreground mx-1 inline size-3" strokeWidth={2} />
        <span className="font-semibold">{toLabel}</span>
        {isReversal ? (
          <span className="text-muted-foreground ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
            {t('cash_transfer.tag_reversal')}
          </span>
        ) : null}
        {isDeleted ? (
          <span className="text-muted-foreground ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">
            {t('cash_transfer.tag_deleted')}
          </span>
        ) : null}
        {row.comment ? (
          <p className="text-muted-foreground mt-0.5 text-[11px]">{row.comment}</p>
        ) : null}
        {row.deleted_reason ? (
          <p className="text-muted-foreground mt-0.5 text-[11px] italic">
            {t('cash_transfer.deleted_reason')}: {row.deleted_reason}
          </p>
        ) : null}
      </td>
      <td className="num text-brand-navy px-4 py-3 text-right text-xs font-bold tabular-nums">
        {formatCurrency(row.amount_cents, currency)}
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">{who}</td>
      <td className="px-4 py-3 text-right">
        {canDelete && !isDeleted && !isReversal ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}
            className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
            aria-label={t('cash_transfer.aria_delete')}
          >
            <Trash2 className="size-3.5" strokeWidth={1.7} />
          </button>
        ) : null}
      </td>
    </tr>
  )
}

/**
 * Модалка деталей перестановки. Стиль — как у CashTransferModal: Dialog
 * 640px, форма с полями Откуда/Куда/Сумма/Дата/Комментарий. Можно
 * редактировать (owner/admin того же салона) и удалить (с указанием
 * причины). Записи reversal_of и soft-deleted — read-only.
 */
function TransferDetailDrawer({
  transfer,
  onClose,
  salonId,
  labelById,
  userNameById,
  currency,
}: {
  transfer: CashTransfer | null
  onClose: () => void
  salonId: string
  labelById: Map<string, string>
  userNameById: Map<string, string>
  currency: string
}) {
  const { t } = useTranslation()
  const { data: registers = [] } = useCashRegisters(salonId, { includeSystem: true })
  const { data: membership } = useSalonMembership(salonId)
  const canEdit = membership?.role === 'owner' || membership?.role === 'admin'

  const update = useUpdateCashTransfer(salonId)
  const softDelete = useSoftDeleteCashTransfer(salonId)

  const isReversal = !!transfer?.reversal_of
  const isDeleted = !!transfer?.deleted_at
  const readOnly = !canEdit || isReversal || isDeleted

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [comment, setComment] = useState('')
  const [dateInput, setDateInput] = useState('')

  // Сброс формы при открытии новой записи.
  useEffect(() => {
    if (!transfer) return
    setFrom(transfer.from_register_id)
    setTo(transfer.to_register_id)
    setAmountInput((transfer.amount_cents / 100).toFixed(2).replace('.', ','))
    setComment(transfer.comment ?? '')
    setDateInput(toLocalISO(new Date(transfer.transferred_at)))
  }, [transfer])

  if (!transfer) return null

  const amountCents = parseAmountToCents(amountInput)
  const transferredAtDate = parseLocalISO(dateInput)

  const isChanged =
    from !== transfer.from_register_id ||
    to !== transfer.to_register_id ||
    amountCents !== transfer.amount_cents ||
    (comment.trim() || null) !== (transfer.comment ?? null) ||
    transferredAtDate.toISOString() !== transfer.transferred_at

  const sameRegisters = from && to && from === to
  const invalidAmount = !amountCents || amountCents <= 0
  const canSave = !readOnly && isChanged && !sameRegisters && !invalidAmount && !!from && !!to

  const author = transfer.created_by ? (userNameById.get(transfer.created_by) ?? '—') : '—'
  const deleter = transfer.deleted_by ? (userNameById.get(transfer.deleted_by) ?? '—') : null

  async function handleSave() {
    try {
      await update.mutateAsync({
        id: transfer!.id,
        fromRegisterId: from,
        toRegisterId: to,
        amountCents,
        comment: comment.trim() || null,
        transferredAt: transferredAtDate,
      })
      toast.success(t('cash_transfer.toast_updated'))
      onClose()
    } catch (e) {
      toast.error(describeRpcError(e))
    }
  }

  async function handleDelete() {
    const reason = window.prompt(t('cash_transfer.delete_prompt'))
    if (!reason || !reason.trim()) return
    try {
      await softDelete.mutateAsync({ id: transfer!.id, reason: reason.trim() })
      toast.success(t('cash_transfer.toast_deleted'))
      onClose()
    } catch (e) {
      toast.error(describeRpcError(e))
    }
  }

  return (
    <Dialog open={!!transfer} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[96vw] gap-0 p-0 sm:!w-[640px] sm:!max-w-[640px]">
        <div className="px-5 pt-4">
          <DialogHeader>
            <DialogTitle>{t('cash_transfer.detail_title')}</DialogTitle>
            <DialogDescription>
              {formatVisitDate(transfer.transferred_at)} ·{' '}
              {formatCurrency(transfer.amount_cents, currency)}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-5 pb-4 pt-3">
          {isDeleted ? (
            <div className="border-destructive/40 bg-destructive/5 mb-3 rounded-md border p-3">
              <p className="text-destructive text-[10px] font-bold uppercase">
                {t('cash_transfer.tag_deleted')}
              </p>
              <p className="text-foreground mt-1 text-xs">
                {formatVisitDate(transfer.deleted_at!)}
                {deleter ? ` · ${deleter}` : ''}
              </p>
              {transfer.deleted_reason ? (
                <p className="text-foreground mt-2 text-sm italic">«{transfer.deleted_reason}»</p>
              ) : null}
            </div>
          ) : null}
          {isReversal ? (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-[10px] font-bold uppercase text-amber-700">
                {t('cash_transfer.tag_reversal')}
              </p>
              <p className="text-foreground mt-1 text-xs">
                {t('cash_transfer.detail_reversal_of')}: {transfer.reversal_of!.slice(0, 8)}
              </p>
            </div>
          ) : null}

          <div className="border-border bg-muted/20 rounded-lg border p-3">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                  {t('cash_transfer.from')}
                </label>
                <Select value={from} onValueChange={setFrom} disabled={readOnly}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder={t('cash_transfer.from_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {registers.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                    {/* Если касса удалена, всё равно показываем текущее значение */}
                    {!labelById.has(transfer.from_register_id) ? (
                      <SelectItem value={transfer.from_register_id}>
                        ({t('cash_transfer.removed_register')})
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              <ArrowRight
                className="text-muted-foreground mx-1 hidden size-5 shrink-0 self-end pb-2 sm:block"
                strokeWidth={2}
              />
              <div className="flex-1">
                <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                  {t('cash_transfer.to')}
                </label>
                <Select value={to} onValueChange={setTo} disabled={readOnly}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder={t('cash_transfer.to_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {registers
                      .filter((r) => r.id !== from)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                    {!labelById.has(transfer.to_register_id) ? (
                      <SelectItem value={transfer.to_register_id}>
                        ({t('cash_transfer.removed_register')})
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mb-2">
              <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                {t('cash_transfer.amount')}
              </label>
              <div className="relative">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="0,00"
                  disabled={readOnly}
                  className="num h-11 pr-12 font-mono text-lg font-bold tabular-nums"
                />
                <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold">
                  {currency}
                </span>
              </div>
            </div>

            <div className="mb-2">
              <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                {t('cash_transfer.comment')}
              </label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('cash_transfer.comment_placeholder')}
                disabled={readOnly}
              />
            </div>

            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                {t('cash_transfer.date')}
              </label>
              <Input
                type="datetime-local"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>

          {/* Мета: автор + дата создания */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground text-[10px] font-bold uppercase">
                {t('cash_transfer.detail_author')}
              </p>
              <p className="text-foreground mt-0.5 text-sm">{author}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[10px] font-bold uppercase">
                {t('cash_transfer.detail_created_at')}
              </p>
              <p className="text-foreground mt-0.5 text-sm">
                {formatVisitDate(transfer.created_at)}
              </p>
            </div>
          </div>
        </div>

        <div className="border-border flex items-center justify-between gap-2 border-t px-5 py-3">
          {!readOnly ? (
            <Button
              variant="ghost"
              size="md"
              onClick={handleDelete}
              disabled={softDelete.isPending}
              className="text-destructive hover:bg-destructive/5"
            >
              <Trash2 className="size-4" strokeWidth={1.7} />
              {t('cash_transfer.action_delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              {t('common.close')}
            </Button>
            {!readOnly ? (
              <Button
                variant="primary"
                size="md"
                onClick={handleSave}
                disabled={!canSave || update.isPending}
              >
                {update.isPending ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.7} />
                ) : (
                  <Pencil className="size-4" strokeWidth={1.7} />
                )}
                {t('cash_transfer.action_save')}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function parseAmountToCents(s: string): number {
  if (!s) return 0
  const norm = s.replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(norm)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

function toLocalISO(d: Date): string {
  const tz = d.getTimezoneOffset()
  const local = new Date(d.getTime() - tz * 60_000)
  return local.toISOString().slice(0, 16)
}

function parseLocalISO(s: string): Date {
  return new Date(s)
}

function describeRpcError(e: unknown): string {
  if (!e) return 'Error'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as { message?: string; details?: string; hint?: string }
  return obj.message ?? obj.details ?? obj.hint ?? 'Error'
}
