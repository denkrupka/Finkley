import { ArrowRight, Loader2, Trash2, Wallet } from 'lucide-react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCashRegisters } from '@/hooks/useCashRegisters'
import {
  useCashTransfers,
  useCreateCashTransfer,
  useRegisterBalances,
  useReverseCashTransfer,
  useSoftDeleteCashTransfer,
  type CashTransfer,
} from '@/hooks/useCashTransfers'
import { useSalon, useSalonMembership } from '@/hooks/useSalons'
import { useTeamMembers } from '@/hooks/useTeam'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatVisitDate } from '@/lib/utils/format-date'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  initialFrom?: string | null
}

/**
 * Модалка «Перестановка средств» — перевод между cash_registers салона.
 * См. ADR-014. Три блока:
 *   1. Карточки касс с балансами + подсветка источника/назначения
 *   2. Форма перевода с превью + confirm-step
 *   3. История трансферов (свернутая по умолчанию)
 */
export function CashTransferModal({ open, onClose, salonId, initialFrom = null }: Props) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const { data: registers = [] } = useCashRegisters(salonId)
  const { data: balances = [], isLoading: loadingBalances } = useRegisterBalances(salonId)
  const balanceById = useMemo(
    () => new Map(balances.map((b) => [b.register_id, b.balance_cents])),
    [balances],
  )
  const labelById = useMemo(() => new Map(registers.map((r) => [r.id, r.label])), [registers])

  const [from, setFrom] = useState<string>(initialFrom ?? '')
  const [to, setTo] = useState<string>('')
  const [amountInput, setAmountInput] = useState<string>('')
  const [comment, setComment] = useState<string>('')
  const [dateInput, setDateInput] = useState<string>(() => toLocalISO(new Date()))
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (open) {
      setFrom(initialFrom ?? '')
      setTo('')
      setAmountInput('')
      setComment('')
      setDateInput(toLocalISO(new Date()))
      setStep('form')
    }
  }, [open, initialFrom])

  const create = useCreateCashTransfer(salonId)
  const reverse = useReverseCashTransfer(salonId)

  const amountCents = parseAmountToCents(amountInput)
  const fromBalance = from ? (balanceById.get(from) ?? 0) : 0
  const toBalance = to ? (balanceById.get(to) ?? 0) : 0

  // Валидация
  const errors: string[] = []
  if (!from) errors.push('from')
  if (!to) errors.push('to')
  if (from && to && from === to) errors.push('same')
  if (!amountCents || amountCents <= 0) errors.push('amount')
  if (amountCents && amountCents > fromBalance) errors.push('insufficient')
  const valid = errors.length === 0

  // Предупреждение про backdate раньше последнего close
  const transferredAtDate = parseLocalISO(dateInput)
  const isBackdate = transferredAtDate.getTime() < Date.now() - 60_000

  async function submit() {
    try {
      const result = await create.mutateAsync({
        from,
        to,
        amountCents,
        comment: comment.trim() || null,
        transferredAt: transferredAtDate,
      })
      const fromLabel = labelById.get(from) ?? from
      const toLabel = labelById.get(to) ?? to
      toast.success(
        t('cash_transfer.toast_success', {
          amount: formatCurrency(amountCents, currency),
          from: fromLabel,
          to: toLabel,
        }),
        {
          duration: 8000,
          action: {
            label: t('cash_transfer.toast_undo'),
            onClick: () => {
              reverse.mutate(result.id, {
                onSuccess: () => toast.success(t('cash_transfer.toast_reversed')),
                onError: (e) => toast.error(describeRpcError(e)),
              })
            },
          },
        },
      )
      // Очищаем форму для возможного нового перевода без закрытия модалки
      setFrom('')
      setTo('')
      setAmountInput('')
      setComment('')
      setDateInput(toLocalISO(new Date()))
      setStep('form')
    } catch (e) {
      toast.error(describeRpcError(e))
      setStep('form')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[96vw] gap-0 p-0 sm:!w-[760px] sm:!max-w-[760px]">
        <div className="px-5 pt-5">
          <DialogHeader>
            <DialogTitle>{t('cash_transfer.title')}</DialogTitle>
            <DialogDescription>{t('cash_transfer.subtitle')}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 pb-5 pt-4">
          {/* Block 1 — Карточки касс */}
          <div className="mb-5">
            <h3 className="text-muted-foreground mb-2 text-xs font-bold uppercase tracking-wider">
              {t('cash_transfer.cards_title')}
            </h3>
            {loadingBalances ? (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            ) : registers.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('cash_transfer.no_registers')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {registers.map((r) => {
                  const bal = balanceById.get(r.id) ?? 0
                  const isFrom = r.id === from
                  const isTo = r.id === to
                  return (
                    <div
                      key={r.id}
                      className={`border-border bg-card rounded-md border p-3 transition-all ${
                        isFrom ? 'border-amber-400 ring-1 ring-amber-300' : ''
                      } ${isTo ? 'border-brand-sage-deep ring-brand-sage ring-1' : ''}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Wallet className="text-muted-foreground size-3.5" strokeWidth={1.7} />
                        <p className="text-foreground truncate text-xs font-semibold">{r.label}</p>
                      </div>
                      <p className="num text-brand-navy mt-1 text-base font-bold tabular-nums">
                        {formatCurrency(bal, currency)}
                      </p>
                      {isFrom ? (
                        <p className="mt-0.5 text-[10px] font-bold uppercase text-amber-700">
                          {t('cash_transfer.tag_source')}
                        </p>
                      ) : isTo ? (
                        <p className="text-brand-sage-deep mt-0.5 text-[10px] font-bold uppercase">
                          {t('cash_transfer.tag_destination')}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Block 2 — Форма / Confirm */}
          {step === 'form' ? (
            <div className="border-border bg-muted/20 rounded-lg border p-4">
              <h3 className="text-brand-navy mb-3 text-sm font-bold">
                {t('cash_transfer.form_title')}
              </h3>

              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                    {t('cash_transfer.from')}
                  </label>
                  <Select value={from || ''} onValueChange={setFrom}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder={t('cash_transfer.from_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {registers.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label} ·{' '}
                          <span className="num text-muted-foreground">
                            {formatCurrency(balanceById.get(r.id) ?? 0, currency)}
                          </span>
                        </SelectItem>
                      ))}
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
                  <Select value={to || ''} onValueChange={setTo}>
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
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mb-3">
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
                    className="num h-14 pr-12 font-mono text-2xl font-bold tabular-nums sm:text-3xl"
                  />
                  <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xl font-semibold">
                    {currency}
                  </span>
                </div>
                {errors.includes('insufficient') ? (
                  <p className="mt-1 text-xs font-semibold text-red-600">
                    {t('cash_transfer.err_insufficient', {
                      balance: formatCurrency(fromBalance, currency),
                    })}
                  </p>
                ) : null}
              </div>

              <div className="mb-3">
                <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                  {t('cash_transfer.comment')}
                </label>
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('cash_transfer.comment_placeholder')}
                />
              </div>

              <div className="mb-3">
                <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                  {t('cash_transfer.date')}
                </label>
                <Input
                  type="datetime-local"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                />
                {isBackdate ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('cash_transfer.warn_backdate')}
                  </p>
                ) : null}
              </div>

              {/* Превью */}
              {from && to && amountCents > 0 ? (
                <div className="border-border bg-card mb-3 grid grid-cols-2 gap-2 rounded-md border p-3">
                  <div>
                    <p className="text-muted-foreground text-[10px] font-bold uppercase">
                      {t('cash_transfer.preview_from')}
                    </p>
                    <p className="text-foreground mt-0.5 truncate text-xs font-semibold">
                      {labelById.get(from)}
                    </p>
                    <p
                      className={`num mt-0.5 text-sm font-bold tabular-nums ${
                        errors.includes('insufficient') ? 'text-red-600' : 'text-brand-navy'
                      }`}
                    >
                      {formatCurrency(fromBalance - amountCents, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-brand-sage-deep text-[10px] font-bold uppercase">
                      {t('cash_transfer.preview_to')}
                    </p>
                    <p className="text-foreground mt-0.5 truncate text-xs font-semibold">
                      {labelById.get(to)}
                    </p>
                    <p className="text-brand-sage-deep num mt-0.5 text-sm font-bold tabular-nums">
                      {formatCurrency(toBalance + amountCents, currency)}
                    </p>
                  </div>
                </div>
              ) : null}

              <Button
                variant="primary"
                size="md"
                disabled={!valid}
                className="w-full"
                onClick={() => setStep('confirm')}
              >
                {t('cash_transfer.button_continue')}
              </Button>
            </div>
          ) : (
            <div className="border-brand-navy bg-card rounded-lg border p-4">
              <h3 className="text-brand-navy mb-3 text-sm font-bold">
                {t('cash_transfer.confirm_title')}
              </h3>
              <div className="bg-muted/20 mb-4 rounded-md p-3">
                <p className="text-foreground mb-2 text-sm">
                  {t('cash_transfer.confirm_summary', {
                    amount: formatCurrency(amountCents, currency),
                    from: labelById.get(from) ?? from,
                    to: labelById.get(to) ?? to,
                  })}
                </p>
                {comment ? (
                  <p className="text-muted-foreground text-xs">
                    {t('cash_transfer.confirm_comment')}: {comment}
                  </p>
                ) : null}
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('cash_transfer.confirm_date')}:{' '}
                  {formatVisitDate(transferredAtDate.toISOString())}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="md"
                  className="flex-1"
                  onClick={() => setStep('form')}
                  disabled={create.isPending}
                >
                  {t('cash_transfer.button_back')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  className="flex-1"
                  onClick={submit}
                  disabled={create.isPending}
                >
                  {create.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t('cash_transfer.button_confirm')
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Block 3 — История */}
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-semibold"
            >
              {showHistory ? '−' : '+'} {t('cash_transfer.history_toggle')}
            </button>
            {showHistory ? <TransfersHistory salonId={salonId} currency={currency} /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// История
// ────────────────────────────────────────────────────────────────────────────

function TransfersHistory({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  const [registerFilter, setRegisterFilter] = useState<string>('')
  const [userFilter, setUserFilter] = useState<string>('')
  const { data: registers = [] } = useCashRegisters(salonId)
  const { data: teamMembers = [] } = useTeamMembers(salonId)
  const labelById = useMemo(() => new Map(registers.map((r) => [r.id, r.label])), [registers])
  const userNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of teamMembers) {
      if (x.user_id) m.set(x.user_id, x.full_name || x.email || '—')
    }
    return m
  }, [teamMembers])

  const { data: page1, isLoading } = useCashTransfers(
    salonId,
    {
      registerId: registerFilter || null,
      userId: userFilter || null,
    },
    page,
    PAGE_SIZE,
  )

  const rows = page1?.rows ?? []
  const totalPages = Math.max(1, Math.ceil((page1?.total ?? 0) / PAGE_SIZE))

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select
          value={registerFilter || 'all'}
          onValueChange={(v) => {
            setRegisterFilter(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('cash_transfer.filter_all_registers')}</SelectItem>
            {registers.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={userFilter || 'all'}
          onValueChange={(v) => {
            setUserFilter(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[200px]">
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
      </div>

      {isLoading ? (
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground p-3 text-sm">{t('cash_transfer.history_empty')}</p>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t('cash_transfer.col_date')}</th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t('cash_transfer.col_route')}
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  {t('cash_transfer.col_amount')}
                </th>
                <th className="px-3 py-2 text-left font-semibold">{t('cash_transfer.col_who')}</th>
                <th className="px-3 py-2" />
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
                />
              ))}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div className="border-border flex items-center justify-between gap-2 border-t px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {t('common.of')}: {page1?.total ?? 0}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
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
                  className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function TransferRow({
  row,
  labelById,
  userNameById,
  currency,
  salonId,
}: {
  row: CashTransfer
  labelById: Map<string, string>
  userNameById: Map<string, string>
  currency: string
  salonId: string
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
    <tr className={`border-border/60 border-t ${isDeleted ? 'opacity-50' : 'hover:bg-muted/30'}`}>
      <td className="text-muted-foreground num px-3 py-2 text-xs">
        {formatVisitDate(row.transferred_at)}
      </td>
      <td className="text-foreground px-3 py-2 text-xs">
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
      <td className="num text-brand-navy px-3 py-2 text-right text-xs font-bold tabular-nums">
        {formatCurrency(row.amount_cents, currency)}
      </td>
      <td className="text-muted-foreground px-3 py-2 text-xs">{who}</td>
      <td className="px-3 py-2 text-right">
        {canDelete && !isDeleted && !isReversal ? (
          <button
            type="button"
            onClick={handleDelete}
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

// ────────────────────────────────────────────────────────────────────────────
// Утилиты
// ────────────────────────────────────────────────────────────────────────────

function parseAmountToCents(s: string): number {
  if (!s) return 0
  const normalized = s.replace(',', '.').trim()
  const n = parseFloat(normalized)
  if (!isFinite(n) || n <= 0) return 0
  return Math.round(n * 100)
}

function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

function parseLocalISO(s: string): Date {
  if (!s) return new Date()
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date() : d
}

function describeRpcError(e: unknown): string {
  if (!e) return 'Error'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as { message?: string; details?: string; hint?: string }
  return obj.message ?? obj.details ?? obj.hint ?? 'Error'
}
