import { ArrowRight, Loader2, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  useCreateCashTransfer,
  useRegisterBalances,
  useReverseCashTransfer,
} from '@/hooks/useCashTransfers'
import { useSalon } from '@/hooks/useSalons'
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
 * См. ADR-014. Два блока:
 *   1. Карточки касс с балансами + подсветка источника/назначения
 *   2. Форма перевода с превью + confirm-step
 *
 * История переехала на отдельный таб /finance → Перестановка средств
 * (TransfersTab) с полноценными фильтрами Откуда/Куда/Сумма/Период.
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
        <div className="px-5 pt-4">
          <DialogHeader>
            <DialogTitle>{t('cash_transfer.title')}</DialogTitle>
            <DialogDescription>{t('cash_transfer.subtitle')}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[88vh] overflow-y-auto px-5 pb-4 pt-3">
          {/* Block 1 — Карточки касс */}
          <div className="mb-3">
            <h3 className="text-muted-foreground mb-1.5 text-xs font-bold uppercase tracking-wider">
              {t('cash_transfer.cards_title')}
            </h3>
            {loadingBalances ? (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            ) : registers.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('cash_transfer.no_registers')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {registers.map((r) => {
                  const bal = balanceById.get(r.id) ?? 0
                  const isFrom = r.id === from
                  const isTo = r.id === to
                  return (
                    <div
                      key={r.id}
                      className={`border-border bg-card rounded-md border p-2 transition-all ${
                        isFrom ? 'border-amber-400 ring-1 ring-amber-300' : ''
                      } ${isTo ? 'border-brand-sage-deep ring-brand-sage ring-1' : ''}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Wallet className="text-muted-foreground size-3.5" strokeWidth={1.7} />
                        <p className="text-foreground truncate text-xs font-semibold">{r.label}</p>
                      </div>
                      <AnimatedAmount cents={bal} currency={currency} />
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
            <div className="border-border bg-muted/20 rounded-lg border p-3">
              <h3 className="text-brand-navy mb-2 text-sm font-bold">
                {t('cash_transfer.form_title')}
              </h3>

              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end">
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
                    className="num h-11 pr-12 font-mono text-xl font-bold tabular-nums sm:text-2xl"
                  />
                  <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold">
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

              <div className="mb-2">
                <label className="text-muted-foreground mb-1 block text-xs font-semibold">
                  {t('cash_transfer.comment')}
                </label>
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('cash_transfer.comment_placeholder')}
                />
              </div>

              <div className="mb-2">
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
                <div className="border-border bg-card mb-2 grid grid-cols-2 gap-2 rounded-md border p-2.5">
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
            <div className="border-brand-navy bg-card rounded-lg border p-3">
              <h3 className="text-brand-navy mb-2 text-sm font-bold">
                {t('cash_transfer.confirm_title')}
              </h3>
              <div className="bg-muted/20 mb-3 rounded-md p-2.5">
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
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// AnimatedAmount — карточка баланса с подсветкой при изменении суммы
// ────────────────────────────────────────────────────────────────────────────

function AnimatedAmount({ cents, currency }: { cents: number; currency: string }) {
  const prev = useRef<number>(cents)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (cents !== prev.current) {
      setFlash(cents > prev.current ? 'up' : 'down')
      prev.current = cents
      const t = setTimeout(() => setFlash(null), 700)
      return () => clearTimeout(t)
    }
  }, [cents])
  return (
    <p
      className={`num mt-0.5 text-sm font-bold tabular-nums transition-colors duration-700 ${
        flash === 'up'
          ? 'text-brand-sage-deep'
          : flash === 'down'
            ? 'text-amber-700'
            : 'text-brand-navy'
      }`}
    >
      {formatCurrency(cents, currency)}
    </p>
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
