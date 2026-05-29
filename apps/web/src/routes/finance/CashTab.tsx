import { format, parseISO } from 'date-fns'
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  Unlock,
  Wallet,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { getDateLocale } from '@/lib/utils/format-date'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCashRegisters, type CashRegisterOption } from '@/hooks/useCashRegisters'
import {
  classifyChannel,
  computeExpected,
  useCloseShift,
  useCurrentShift,
  useOpenShift,
  useShiftHistory,
  useShiftTransactions,
  type CashShift,
  type ShiftTxn,
} from '@/hooks/useCashShifts'
import { useSalon } from '@/hooks/useSalons'
import { useTeamMembers } from '@/hooks/useTeam'
import { formatCurrency } from '@/lib/utils/format-currency'
import { cn } from '@/lib/utils/cn'
import { CashTransferModal } from '@/routes/expenses/CashTransferModal'

/**
 * Финансы → Касса. Кассовая дисциплина: открытие смены с opening cash,
 * слепая сверка и закрытие. См. полное описание задачи в коммите.
 *
 * Содержит:
 *   - 3 KPI-карточки (начало, сейчас, конец)
 *   - Кнопка «Открыть день» если смена закрыта
 *   - Раздел транзакций текущей смены (если open) или закрытой смены
 *   - Кнопка «Закрыть день» (если open) или «Открыть новый день» (если closed)
 *   - История смен за последние 30 дней
 */
export function CashTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const { data: currentShift, isLoading: shiftLoading } = useCurrentShift(salonId)
  const { data: history = [] } = useShiftHistory(salonId)
  const { data: txns = [] } = useShiftTransactions(salonId, currentShift ?? null)
  const { data: team = [] } = useTeamMembers(salonId)
  const { data: cashRegisters = [] } = useCashRegisters(salonId)

  const openShift = useOpenShift(salonId)
  const closeShift = useCloseShift(salonId)

  const [openDialogShown, setOpenDialogShown] = useState(false)
  const [closeDialogShown, setCloseDialogShown] = useState(false)
  const [drawerShift, setDrawerShift] = useState<CashShift | null>(null)
  const [postClosePrompt, setPostClosePrompt] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)

  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of team) {
      if (!m.user_id) continue
      map.set(m.user_id, m.full_name || m.email || '—')
    }
    return map
  }, [team])

  const expected = computeExpected(currentShift ?? null, txns, cashRegisters)
  const opening = currentShift?.opening_amount_cents ?? 0
  const cashNow = expected.expected_cash_cents
  const todayLabel = format(new Date(), 'EEEE, d MMMM yyyy', { locale: getDateLocale() })

  /** Универсальный extractor описания ошибки. Supabase возвращает плейн-
   *  объект {message,details,hint,code}, не Error instance — поэтому
   *  String(err) даёт '[object Object]'. Тянем .message руками. */
  function describeError(err: unknown): string {
    if (err instanceof Error) return err.message
    if (err && typeof err === 'object') {
      const o = err as { message?: unknown; details?: unknown; hint?: unknown }
      if (typeof o.message === 'string') return o.message
      if (typeof o.details === 'string') return o.details
      if (typeof o.hint === 'string') return o.hint
      try {
        return JSON.stringify(err)
      } catch {
        return String(err)
      }
    }
    return String(err)
  }

  function handleOpenShift(input: { opening_amount_cents: number; opening_comment?: string }) {
    openShift.mutate(input, {
      onSuccess: () => {
        toast.success(t('finance.cash.toast_opened'))
        setOpenDialogShown(false)
      },
      onError: (err) =>
        toast.error(t('finance.cash.toast_open_error'), {
          description: describeError(err),
        }),
    })
  }

  function handleCloseShift(input: {
    actual_cash_cents: number
    actual_card_cents: number
    close_comment?: string
    discrepancy_reason?: string
  }) {
    if (!currentShift) return
    closeShift.mutate(
      {
        shiftId: currentShift.id,
        ...input,
        expected_cash_cents: expected.expected_cash_cents,
        expected_card_cents: expected.expected_card_cents,
      },
      {
        onSuccess: () => {
          toast.success(t('finance.cash.toast_closed'))
          setCloseDialogShown(false)
          setPostClosePrompt(true)
        },
        onError: (err) =>
          toast.error(t('finance.cash.toast_close_error'), {
            description: describeError(err),
          }),
      },
    )
  }

  if (shiftLoading) {
    return <div className="bg-muted/40 h-32 animate-pulse rounded-md" />
  }

  // Дефолт для opening — закрывающая сумма предыдущей смены, иначе
  // salons.opening_cash_balance_cents (если есть).
  const lastClosed = history[0]
  const defaultOpening = lastClosed?.actual_cash_cents ?? salon?.opening_cash_balance_cents ?? 0

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок: дата + статус */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('finance.cash.title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm capitalize">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {currentShift ? (
            <>
              <span className="bg-brand-sage-soft text-brand-sage inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold">
                <Unlock className="size-3" strokeWidth={2.2} />
                {t('finance.cash.status_open', {
                  name: currentShift.opened_by_user_id
                    ? (userNameById.get(currentShift.opened_by_user_id) ?? '—')
                    : '—',
                  time: format(parseISO(currentShift.opened_at), 'HH:mm'),
                })}
              </span>
              <Button size="md" onClick={() => setCloseDialogShown(true)}>
                <Lock className="size-4" strokeWidth={2} />
                {t('finance.cash.close_shift')}
              </Button>
            </>
          ) : (
            <>
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold">
                <Lock className="size-3" strokeWidth={2.2} />
                {t('finance.cash.status_closed')}
              </span>
              <Button size="md" onClick={() => setOpenDialogShown(true)}>
                <Unlock className="size-4" strokeWidth={2} />
                {isClosedToday(lastClosed)
                  ? t('finance.cash.open_new_shift')
                  : t('finance.cash.open_shift')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 3 KPI карточки */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          title={t('finance.cash.kpi_opening')}
          value={currentShift ? formatCurrency(opening, currency) : '—'}
          hint={currentShift ? format(parseISO(currentShift.opened_at), 'HH:mm') : undefined}
          tone="navy"
        />
        <KpiCard
          title={t('finance.cash.kpi_now')}
          value={currentShift ? formatCurrency(cashNow, currency) : '—'}
          hint={
            currentShift
              ? t('finance.cash.kpi_now_hint', {
                  defaultValue: 'opening + наличные доходы − наличные расходы',
                })
              : undefined
          }
          tone="sage"
        />
        <KpiCard
          title={t('finance.cash.kpi_closing')}
          value={
            currentShift
              ? '—'
              : lastClosed?.actual_cash_cents != null
                ? formatCurrency(lastClosed.actual_cash_cents, currency)
                : '—'
          }
          hint={
            lastClosed?.closed_at
              ? format(parseISO(lastClosed.closed_at), 'd MMM, HH:mm', { locale: getDateLocale() })
              : undefined
          }
          tone="muted"
        />
      </div>

      {/* Транзакции текущей смены */}
      {currentShift ? (
        <TransactionsBlock
          txns={txns}
          currency={currency}
          userNameById={userNameById}
          cashRegisters={cashRegisters}
        />
      ) : isClosedToday(lastClosed) ? (
        <ClosedTodayCard shift={lastClosed!} currency={currency} userNameById={userNameById} />
      ) : (
        <div className="border-border bg-card shadow-finsm rounded-lg border p-6 text-center">
          <Wallet className="text-muted-foreground mx-auto size-8" strokeWidth={1.5} />
          <p className="text-foreground mt-3 text-sm font-semibold">
            {t('finance.cash.no_shift_title')}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
            {t('finance.cash.no_shift_body')}
          </p>
        </div>
      )}

      {/* История смен */}
      <ShiftHistoryTable
        history={history}
        currency={currency}
        userNameById={userNameById}
        onSelect={setDrawerShift}
      />

      {/* Modals */}
      <OpenShiftDialog
        open={openDialogShown}
        onOpenChange={setOpenDialogShown}
        defaultOpeningCents={defaultOpening}
        currency={currency}
        onSubmit={handleOpenShift}
        pending={openShift.isPending}
      />
      {currentShift ? (
        <CloseShiftDialog
          open={closeDialogShown}
          onOpenChange={setCloseDialogShown}
          expected={expected}
          currency={currency}
          onSubmit={handleCloseShift}
          pending={closeShift.isPending}
        />
      ) : null}
      <ShiftDetailDrawer
        shift={drawerShift}
        onClose={() => setDrawerShift(null)}
        salonId={salonId}
        currency={currency}
        userNameById={userNameById}
      />

      <CashTransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        salonId={salonId}
      />

      <Dialog open={postClosePrompt} onOpenChange={setPostClosePrompt}>
        <DialogContent className="sm:!w-[440px] sm:!max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('cash_transfer.post_close_title')}</DialogTitle>
            <DialogDescription>{t('cash_transfer.post_close_subtitle')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setPostClosePrompt(false)}
              className="border-border border"
            >
              {t('cash_transfer.post_close_no')}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setPostClosePrompt(false)
                setTransferOpen(true)
              }}
            >
              <ArrowLeftRight className="size-4" strokeWidth={2} />
              {t('cash_transfer.post_close_yes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

/** True если смена закрыта и closed_at попадает на сегодняшний день
 *  в локальном таймзоне юзера. Используется чтобы показать «итоги дня»
 *  сразу после закрытия (Состояние 4 спеки). */
function isClosedToday(shift: CashShift | null | undefined): boolean {
  if (!shift || !shift.closed_at) return false
  const closed = new Date(shift.closed_at)
  const today = new Date()
  return (
    closed.getFullYear() === today.getFullYear() &&
    closed.getMonth() === today.getMonth() &&
    closed.getDate() === today.getDate()
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Closed-today card (Состояние 4 спеки)

function ClosedTodayCard({
  shift,
  currency,
  userNameById,
}: {
  shift: CashShift
  currency: string
  userNameById: Map<string, string>
}) {
  const { t } = useTranslation()
  const closerName = shift.closed_by_user_id
    ? (userNameById.get(shift.closed_by_user_id) ?? '—')
    : '—'
  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-foreground text-sm font-bold">
          {t('finance.cash.closed_today_title')}
        </h3>
        <span className="text-muted-foreground text-xs">
          {t('finance.cash.closed_today_meta', {
            name: closerName,
            time: shift.closed_at ? format(parseISO(shift.closed_at), 'HH:mm') : '—',
          })}
        </span>
      </div>
      <div className="border-border rounded-md border">
        <ReconciliationRow
          label={t('finance.cash.row_cash')}
          expected={shift.expected_cash_cents ?? 0}
          actual={shift.actual_cash_cents ?? 0}
          diff={shift.diff_cash_cents ?? 0}
          currency={currency}
        />
        <div className="border-t" />
        <ReconciliationRow
          label={t('finance.cash.row_card')}
          expected={shift.expected_card_cents ?? 0}
          actual={shift.actual_card_cents ?? 0}
          diff={shift.diff_card_cents ?? 0}
          currency={currency}
        />
      </div>
      {shift.discrepancy_reason ? (
        <div className="bg-muted/30 mt-3 rounded-md p-2 text-xs">
          <span className="text-muted-foreground font-bold uppercase tracking-wider">
            {t('finance.cash.reason_label')}:{' '}
          </span>
          {shift.discrepancy_reason}
        </div>
      ) : null}
      {shift.close_comment ? (
        <div className="bg-muted/30 mt-2 rounded-md p-2 text-xs">
          <span className="text-muted-foreground font-bold uppercase tracking-wider">
            {t('finance.cash.close_comment_label')}:{' '}
          </span>
          {shift.close_comment}
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI card

function KpiCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string
  value: string
  hint?: string
  tone: 'navy' | 'sage' | 'muted'
}) {
  const toneCls: Record<typeof tone, string> = {
    navy: 'text-brand-navy',
    sage: 'text-brand-sage-deep',
    muted: 'text-muted-foreground',
  }
  return (
    <div className="border-border bg-card shadow-finsm flex flex-col gap-1 rounded-lg border p-4">
      <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
        {title}
      </p>
      <p className={cn('num text-2xl font-bold tracking-tight', toneCls[tone])}>{value}</p>
      {hint ? <p className="text-muted-foreground text-[11px]">{hint}</p> : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactions block

function TransactionsBlock({
  txns,
  currency,
  userNameById,
  cashRegisters,
}: {
  txns: ShiftTxn[]
  currency: string
  userNameById: Map<string, string>
  cashRegisters: CashRegisterOption[]
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<'all' | 'cash' | 'card' | 'other'>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return txns
    return txns.filter(
      (x) => classifyChannel(x.payment_method, x.cash_register_id, cashRegisters) === filter,
    )
  }, [txns, filter, cashRegisters])

  const income = filtered.filter((t) => t.amount_cents > 0)
  const expenses = filtered.filter((t) => t.amount_cents < 0)
  const totalIncomeByMethod = sumByMethod(income)
  const totalExpenseByMethod = sumByMethod(expenses)

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-bold">{t('finance.cash.txns_title')}</h3>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('finance.cash.filter_all')}</SelectItem>
            <SelectItem value="cash">{t('finance.cash.filter_cash')}</SelectItem>
            <SelectItem value="card">{t('finance.cash.filter_card')}</SelectItem>
            <SelectItem value="other">{t('finance.cash.filter_other')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <TxnSection
        title={t('finance.cash.section_income')}
        txns={income}
        currency={currency}
        userNameById={userNameById}
        totalByMethod={totalIncomeByMethod}
        emptyText={t('finance.cash.no_income')}
      />
      <div className="my-3 border-t border-dashed" />
      <TxnSection
        title={t('finance.cash.section_expense')}
        txns={expenses}
        currency={currency}
        userNameById={userNameById}
        totalByMethod={totalExpenseByMethod}
        emptyText={t('finance.cash.no_expense')}
      />
    </div>
  )
}

function sumByMethod(txns: ShiftTxn[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const t of txns) {
    const key = t.payment_method ?? 'other'
    map[key] = (map[key] ?? 0) + t.amount_cents
  }
  return map
}

function TxnSection({
  title,
  txns,
  currency,
  userNameById,
  totalByMethod,
  emptyText,
}: {
  title: string
  txns: ShiftTxn[]
  currency: string
  userNameById: Map<string, string>
  totalByMethod: Record<string, number>
  emptyText: string
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          {title}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {Object.entries(totalByMethod).map(([m, sum]) => (
            <span
              key={m}
              className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold"
            >
              {t(`payment_methods.${m}`, { defaultValue: m })}:{' '}
              <span className="num">{formatCurrency(Math.abs(sum), currency)}</span>
            </span>
          ))}
        </div>
      </div>
      {txns.length === 0 ? (
        <p className="text-muted-foreground py-2 text-xs italic">{emptyText}</p>
      ) : (
        <ul className="divide-border/60 flex flex-col divide-y">
          {txns.map((tx) => (
            <li
              key={`${tx.kind}-${tx.id}`}
              className="flex items-center justify-between gap-2 py-1.5 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Clock className="text-muted-foreground size-3 shrink-0" strokeWidth={1.7} />
                <span className="num text-muted-foreground w-12">
                  {format(parseISO(tx.at), 'HH:mm')}
                </span>
                <span className="text-foreground truncate font-medium">{tx.label}</span>
                {tx.created_by && userNameById.get(tx.created_by) ? (
                  <span className="text-muted-foreground hidden sm:inline">
                    · {userNameById.get(tx.created_by)}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {tx.payment_method ? (
                  <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                    {t(`payment_methods.${tx.payment_method}`, {
                      defaultValue: tx.payment_method,
                    })}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'num font-bold',
                    tx.amount_cents >= 0 ? 'text-brand-sage-deep' : 'text-destructive',
                  )}
                >
                  {tx.amount_cents >= 0 ? '+' : ''}
                  {formatCurrency(tx.amount_cents, currency)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Open shift dialog

function OpenShiftDialog({
  open,
  onOpenChange,
  defaultOpeningCents,
  currency,
  onSubmit,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultOpeningCents: number
  currency: string
  onSubmit: (input: { opening_amount_cents: number; opening_comment?: string }) => void
  pending: boolean
}) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState((defaultOpeningCents / 100).toFixed(2))
  const [comment, setComment] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.cash.open_shift_title')}</DialogTitle>
          <DialogDescription>{t('finance.cash.open_shift_subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 pb-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="open-amount">
              {t('finance.cash.opening_amount_label', { currency })}
            </Label>
            <Input
              id="open-amount"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            <p className="text-muted-foreground text-xs">{t('finance.cash.opening_amount_hint')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="open-comment">{t('finance.cash.opening_comment_label')}</Label>
            <Input
              id="open-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('finance.cash.opening_comment_placeholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              const n = Number(amount.replace(',', '.'))
              if (!Number.isFinite(n) || n < 0) {
                toast.error(t('finance.cash.invalid_amount'))
                return
              }
              onSubmit({
                opening_amount_cents: Math.round(n * 100),
                opening_comment: comment.trim() || undefined,
              })
            }}
            disabled={pending}
          >
            {pending ? t('common.loading') : t('finance.cash.open_shift_submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Close shift dialog (2-step blind reconciliation)

function CloseShiftDialog({
  open,
  onOpenChange,
  expected,
  currency,
  onSubmit,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expected: { expected_cash_cents: number; expected_card_cents: number }
  currency: string
  onSubmit: (input: {
    actual_cash_cents: number
    actual_card_cents: number
    close_comment?: string
    discrepancy_reason?: string
  }) => void
  pending: boolean
}) {
  const { t } = useTranslation()
  const [step, setStep] = useState<1 | 2>(1)
  const [cashStr, setCashStr] = useState('')
  const [cardStr, setCardStr] = useState('')
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')

  // Сбрасываем стейт при каждом открытии.
  function reset() {
    setStep(1)
    setCashStr('')
    setCardStr('')
    setComment('')
    setReason('')
  }

  const actualCashCents = Math.round((Number(cashStr.replace(',', '.')) || 0) * 100)
  const actualCardCents = Math.round((Number(cardStr.replace(',', '.')) || 0) * 100)
  const diffCash = actualCashCents - expected.expected_cash_cents
  const diffCard = actualCardCents - expected.expected_card_cents
  const hasDiff = diffCash !== 0 || diffCard !== 0

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? t('finance.cash.close_step1_title') : t('finance.cash.close_step2_title')}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? t('finance.cash.close_step1_subtitle')
              : t('finance.cash.close_step2_subtitle')}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="flex flex-col gap-3 px-5 pb-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="close-cash">{t('finance.cash.actual_cash_label')} *</Label>
              <Input
                id="close-cash"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={cashStr}
                onChange={(e) => setCashStr(e.target.value)}
                autoFocus
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="close-card">{t('finance.cash.actual_card_label')} *</Label>
              <Input
                id="close-card"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={cardStr}
                onChange={(e) => setCardStr(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="close-comment">{t('finance.cash.close_comment_label')}</Label>
              <Input
                id="close-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('finance.cash.close_comment_placeholder')}
              />
            </div>
            <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">
              {t('finance.cash.blind_warning')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-5 pb-2">
            <div className="border-border rounded-md border">
              <ReconciliationRow
                label={t('finance.cash.row_cash')}
                expected={expected.expected_cash_cents}
                actual={actualCashCents}
                diff={diffCash}
                currency={currency}
              />
              <div className="border-t" />
              <ReconciliationRow
                label={t('finance.cash.row_card')}
                expected={expected.expected_card_cents}
                actual={actualCardCents}
                diff={diffCard}
                currency={currency}
              />
            </div>
            {hasDiff ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="close-reason">{t('finance.cash.reason_label')} *</Label>
                <Input
                  id="close-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('finance.cash.reason_placeholder')}
                  autoFocus
                />
              </div>
            ) : (
              <p className="bg-brand-sage-soft text-brand-sage rounded-md p-2 text-xs font-semibold">
                <Check className="mr-1 inline size-3.5" strokeWidth={2.4} />
                {t('finance.cash.no_diff')}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => {
                  if (cashStr.trim() === '' || cardStr.trim() === '') {
                    toast.error(t('finance.cash.fill_actuals'))
                    return
                  }
                  setStep(2)
                }}
                disabled={pending}
              >
                {t('common.continue', { defaultValue: 'Продолжить' })}
                <ArrowRight className="size-4" strokeWidth={2} />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={pending}>
                <ArrowLeft className="size-4" strokeWidth={2} />
                {t('common.back')}
              </Button>
              <Button
                onClick={() => {
                  if (hasDiff && !reason.trim()) {
                    toast.error(t('finance.cash.reason_required'))
                    return
                  }
                  onSubmit({
                    actual_cash_cents: actualCashCents,
                    actual_card_cents: actualCardCents,
                    close_comment: comment.trim() || undefined,
                    discrepancy_reason: hasDiff ? reason.trim() : undefined,
                  })
                }}
                disabled={pending}
              >
                <Lock className="size-4" strokeWidth={2} />
                {pending ? t('common.loading') : t('finance.cash.close_shift')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReconciliationRow({
  label,
  expected,
  actual,
  diff,
  currency,
}: {
  label: string
  expected: number
  actual: number
  diff: number
  currency: string
}) {
  const { t } = useTranslation()
  const diffTone =
    diff === 0 ? 'text-muted-foreground' : diff < 0 ? 'text-destructive' : 'text-amber-700'
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_repeat(3,minmax(100px,1fr))] gap-2 px-3 py-2 text-xs',
        diff !== 0 && (diff < 0 ? 'bg-destructive/5' : 'bg-amber-50'),
      )}
    >
      <span className="text-foreground font-semibold">{label}</span>
      <span className="text-muted-foreground text-right">
        <span className="block text-[10px] uppercase tracking-wider">
          {t('finance.cash.col_expected')}
        </span>
        <span className="num font-bold">{formatCurrency(expected, currency)}</span>
      </span>
      <span className="text-muted-foreground text-right">
        <span className="block text-[10px] uppercase tracking-wider">
          {t('finance.cash.col_actual')}
        </span>
        <span className="num text-foreground font-bold">{formatCurrency(actual, currency)}</span>
      </span>
      <span className="text-right">
        <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
          {t('finance.cash.col_diff')}
        </span>
        <span className={cn('num font-bold', diffTone)}>
          {diff > 0 ? '+' : ''}
          {formatCurrency(diff, currency)}
        </span>
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shift history table

function ShiftHistoryTable({
  history,
  currency,
  userNameById,
  onSelect,
}: {
  history: CashShift[]
  currency: string
  userNameById: Map<string, string>
  onSelect: (shift: CashShift) => void
}) {
  const { t } = useTranslation()
  const [staffFilter, setStaffFilter] = useState<string>('')

  const filtered = staffFilter
    ? history.filter(
        (s) => s.opened_by_user_id === staffFilter || s.closed_by_user_id === staffFilter,
      )
    : history

  const uniqueStaff = useMemo(() => {
    const set = new Set<string>()
    for (const s of history) {
      if (s.opened_by_user_id) set.add(s.opened_by_user_id)
      if (s.closed_by_user_id) set.add(s.closed_by_user_id)
    }
    return Array.from(set)
  }, [history])

  if (history.length === 0) return null

  return (
    <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h3 className="text-foreground text-sm font-bold">{t('finance.cash.history_title')}</h3>
        {uniqueStaff.length > 1 ? (
          <Select
            value={staffFilter || 'all'}
            onValueChange={(v) => setStaffFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('finance.cash.filter_all_staff')}</SelectItem>
              {uniqueStaff.map((u) => (
                <SelectItem key={u} value={u}>
                  {userNameById.get(u) ?? '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {/* Mobile audit (2026-05-30): min-w на таблице — иначе на iPhone
          (375-414px) 8+ колонок сжимаются в нечитаемую кашу. */}
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/40 text-muted-foreground text-[11px] uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">{t('finance.cash.col_date')}</th>
            <th className="px-3 py-2 text-left font-semibold">{t('finance.cash.col_opened_by')}</th>
            <th className="px-3 py-2 text-left font-semibold">{t('finance.cash.col_closed_by')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('finance.cash.col_opening')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('finance.cash.col_closing')}</th>
            <th className="px-3 py-2 text-right font-semibold">
              {t('finance.cash.col_diff_cash')}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {t('finance.cash.col_diff_card')}
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <tr
              key={s.id}
              onClick={() => onSelect(s)}
              className="border-border/60 hover:bg-muted/30 cursor-pointer border-t text-xs"
            >
              <td className="num text-foreground px-3 py-2 font-semibold">
                {format(parseISO(s.opened_at), 'd MMM yyyy', { locale: getDateLocale() })}
              </td>
              <td className="text-muted-foreground px-3 py-2">
                {s.opened_by_user_id ? (userNameById.get(s.opened_by_user_id) ?? '—') : '—'}
              </td>
              <td className="text-muted-foreground px-3 py-2">
                {s.closed_by_user_id ? (userNameById.get(s.closed_by_user_id) ?? '—') : '—'}
              </td>
              <td className="num px-3 py-2 text-right">
                {formatCurrency(s.opening_amount_cents, currency)}
              </td>
              <td className="num px-3 py-2 text-right">
                {s.actual_cash_cents != null ? formatCurrency(s.actual_cash_cents, currency) : '—'}
              </td>
              <td
                className={cn(
                  'num px-3 py-2 text-right',
                  s.diff_cash_cents == null
                    ? ''
                    : s.diff_cash_cents < 0
                      ? 'text-destructive'
                      : s.diff_cash_cents > 0
                        ? 'text-amber-700'
                        : 'text-muted-foreground',
                )}
              >
                {s.diff_cash_cents == null
                  ? '—'
                  : `${s.diff_cash_cents > 0 ? '+' : ''}${formatCurrency(s.diff_cash_cents, currency)}`}
              </td>
              <td
                className={cn(
                  'num px-3 py-2 text-right',
                  s.diff_card_cents == null
                    ? ''
                    : s.diff_card_cents < 0
                      ? 'text-destructive'
                      : s.diff_card_cents > 0
                        ? 'text-amber-700'
                        : 'text-muted-foreground',
                )}
              >
                {s.diff_card_cents == null
                  ? '—'
                  : `${s.diff_card_cents > 0 ? '+' : ''}${formatCurrency(s.diff_card_cents, currency)}`}
              </td>
              <td className="px-2 py-2 text-right">
                <ChevronRight className="text-muted-foreground size-4" strokeWidth={1.7} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shift detail drawer (clicking on a history row)

function ShiftDetailDrawer({
  shift,
  onClose,
  salonId,
  currency,
  userNameById,
}: {
  shift: CashShift | null
  onClose: () => void
  salonId: string
  currency: string
  userNameById: Map<string, string>
}) {
  const { t } = useTranslation()
  const { data: txns = [] } = useShiftTransactions(salonId, shift)

  if (!shift) return null

  return (
    <Dialog open={!!shift} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:!w-[720px] sm:!max-w-[720px]">
        <DialogHeader>
          <DialogTitle>
            {t('finance.cash.detail_title', {
              date: format(parseISO(shift.opened_at), 'd MMM yyyy', { locale: getDateLocale() }),
            })}
          </DialogTitle>
          <DialogDescription>
            {format(parseISO(shift.opened_at), 'HH:mm')}
            {' — '}
            {shift.closed_at ? format(parseISO(shift.closed_at), 'HH:mm') : '...'}
            {' · '}
            {t('finance.cash.detail_opener', {
              name: shift.opened_by_user_id
                ? (userNameById.get(shift.opened_by_user_id) ?? '—')
                : '—',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 pb-2">
          {/* Reconciliation summary */}
          <div className="border-border rounded-md border">
            <ReconciliationRow
              label={t('finance.cash.row_cash')}
              expected={shift.expected_cash_cents ?? 0}
              actual={shift.actual_cash_cents ?? 0}
              diff={shift.diff_cash_cents ?? 0}
              currency={currency}
            />
            <div className="border-t" />
            <ReconciliationRow
              label={t('finance.cash.row_card')}
              expected={shift.expected_card_cents ?? 0}
              actual={shift.actual_card_cents ?? 0}
              diff={shift.diff_card_cents ?? 0}
              currency={currency}
            />
          </div>
          {shift.discrepancy_reason ? (
            <div className="bg-muted/30 rounded-md p-2 text-xs">
              <span className="text-muted-foreground font-bold uppercase tracking-wider">
                {t('finance.cash.reason_label')}:{' '}
              </span>
              {shift.discrepancy_reason}
            </div>
          ) : null}
          {shift.close_comment ? (
            <div className="bg-muted/30 rounded-md p-2 text-xs">
              <span className="text-muted-foreground font-bold uppercase tracking-wider">
                {t('finance.cash.close_comment_label')}:{' '}
              </span>
              {shift.close_comment}
            </div>
          ) : null}

          {/* Transactions list */}
          <div>
            <div className="text-muted-foreground mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider">
              <ChevronDown className="size-3" strokeWidth={2} />
              {t('finance.cash.detail_txns')}
            </div>
            {txns.length === 0 ? (
              <p className="text-muted-foreground text-xs italic">
                {t('finance.cash.detail_no_txns')}
              </p>
            ) : (
              <ul className="divide-border/60 flex max-h-[40vh] flex-col divide-y overflow-y-auto">
                {txns.map((tx) => (
                  <li
                    key={`${tx.kind}-${tx.id}`}
                    className="flex items-center justify-between gap-2 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="num text-muted-foreground w-12">
                        {format(parseISO(tx.at), 'HH:mm')}
                      </span>
                      <span className="text-foreground truncate">{tx.label}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {tx.payment_method ? (
                        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                          {t(`payment_methods.${tx.payment_method}`, {
                            defaultValue: tx.payment_method,
                          })}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'num font-bold',
                          tx.amount_cents >= 0 ? 'text-brand-sage-deep' : 'text-destructive',
                        )}
                      >
                        {tx.amount_cents >= 0 ? '+' : ''}
                        {formatCurrency(tx.amount_cents, currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="size-4" strokeWidth={1.8} />
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
