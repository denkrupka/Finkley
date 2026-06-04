import { Landmark, Link2, Link2Off, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBankLinkedIncomeIds } from '@/hooks/useBanking'
import { useIsVatPayer } from '@/hooks/useIsVatPayer'
import {
  useDeleteOtherIncome,
  useOtherIncomeCategories,
  useUpdateOtherIncome,
  type OtherIncomeRow,
} from '@/hooks/useOtherIncomes'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import { useSalon } from '@/hooks/useSalons'
import type { PaymentMethod } from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { computeNet, defaultVatRate } from '@/lib/utils/vat'
import { VatBreakdownInput } from '@/components/ui/VatBreakdownInput'
import { LinkOtherIncomeToBankDialog } from '@/routes/banking/LinkOtherIncomeToBankDialog'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  currency: string
  income: OtherIncomeRow | null
  /** T36 — read-only mode: скрывает Submit/Delete, показывает warning. */
  readOnly?: boolean
}

/**
 * Редактирование строки прочего дохода. Открывается из SalesTab кликом по
 * строке (рядом с retail-визитами они мешаются — для них VisitDetailModal,
 * для прочих доходов своя форма с категорией / суммой / способом оплаты /
 * кассой / датой / комментарием).
 */
export function OtherIncomeEditModal({
  open,
  onClose,
  salonId,
  currency,
  income,
  readOnly = false,
}: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const update = useUpdateOtherIncome(salonId)
  const remove = useDeleteOtherIncome(salonId)
  const { data: categories = [] } = useOtherIncomeCategories(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  const { data: bankLinked } = useBankLinkedIncomeIds(salonId)
  const { data: salonData } = useSalon(salonId)
  const isVatPayer = useIsVatPayer(salonId)
  const country = salonData?.country_code ?? 'PL'
  const isBankLinked = income ? (bankLinked?.otherIncomeIds.has(income.id) ?? false) : false

  const [categoryId, setCategoryId] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [cashRegisterId, setCashRegisterId] = useState<string>('')
  const [comment, setComment] = useState<string>('')
  const [incomeAt, setIncomeAt] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  // VAT-state — синхронизирован с amount (брутто).
  const [netCents, setNetCents] = useState(0)
  const [grossCents, setGrossCents] = useState(0)
  const [ratePct, setRatePct] = useState<number>(() => defaultVatRate(country))

  useEffect(() => {
    if (open && income) {
      setCategoryId(income.category_id ?? '')
      setAmount((income.amount_cents / 100).toFixed(2))
      setPaymentMethod((income.payment_method ?? '') as PaymentMethod | '')
      setCashRegisterId(income.cash_register_id ?? '')
      setComment(income.comment ?? '')
      setIncomeAt(income.income_at)
      // VAT prefill: используем сохранённые поля если есть, иначе recompute
      // по дефолтной ставке.
      const rate = income.vat_rate_pct ?? defaultVatRate(country)
      const gross = income.amount_cents
      const net = income.amount_net_cents ?? computeNet(gross, rate)
      setRatePct(rate)
      setGrossCents(gross)
      setNetCents(net)
    }
  }, [open, income, country])

  if (!income) return null

  function handleSave() {
    if (!income) return
    // При isVatPayer берём gross из VAT-state (juzer редактировал через
    // breakdown), иначе из text input.
    const cents = isVatPayer ? grossCents : Math.round(Number(amount.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error(t('income.other_form.errors.amount_positive'))
      return
    }
    update.mutate(
      {
        id: income.id,
        category_id: categoryId || null,
        amount_cents: cents,
        payment_method: (paymentMethod || null) as PaymentMethod | null,
        cash_register_id: cashRegisterId || null,
        comment: comment.trim() || null,
        income_at: incomeAt,
        // VAT-разбивка пишется только когда фирма плательщик. Иначе оставляем
        // существующие значения нетронутыми (могут быть null если запись
        // создана до включения vat_payer).
        ...(isVatPayer
          ? {
              amount_net_cents: netCents,
              vat_rate_pct: ratePct,
              vat_skipped: income.vat_skipped ?? false,
            }
          : {}),
      },
      {
        onSuccess: () => {
          toast.success(t('income.other.toast_updated'))
          onClose()
        },
        onError: (e) =>
          toast.error(t('common.error_generic'), {
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    )
  }

  async function handleUnlinkBank() {
    if (!income) return
    setUnlinking(true)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ linked_other_income_id: null })
        .eq('linked_other_income_id', income.id)
      if (error) throw error
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['bank-linked-income-ids', salonId] }),
        qc.invalidateQueries({ queryKey: ['bank-inflows', salonId] }),
        qc.invalidateQueries({ queryKey: ['other-incomes', salonId] }),
      ])
      toast.success(t('banking.unlink_toast'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUnlinking(false)
    }
  }

  function handleDelete() {
    if (!income) return
    if (!window.confirm(t('income.other.confirm_delete'))) return
    remove.mutate(income.id, {
      onSuccess: () => {
        toast.success(t('income.other.toast_deleted'))
        onClose()
      },
      onError: (e) =>
        toast.error(t('common.error_generic'), {
          description: e instanceof Error ? e.message : String(e),
        }),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0">
        <div className="border-border shrink-0 border-b px-5 py-3">
          <DialogHeader>
            <DialogTitle>{t('income.other_edit.title')}</DialogTitle>
          </DialogHeader>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-category">{t('income.other_form.category')}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="oi-edit-category">
                <SelectValue placeholder={t('income.other_form.category_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-amount">
              {isVatPayer
                ? t('income.other_form.amount_gross', {
                    currency,
                    defaultValue: 'Сумма (брутто, {{currency}})',
                  })
                : `${t('income.other_form.amount')} (${currency})`}
            </Label>
            {isVatPayer ? (
              <VatBreakdownInput
                netCents={netCents}
                ratePct={ratePct}
                grossCents={grossCents}
                onChange={(next) => {
                  setNetCents(next.netCents)
                  setRatePct(next.ratePct)
                  setGrossCents(next.grossCents)
                  setAmount((next.grossCents / 100).toFixed(2))
                }}
                countryCode={country}
                currency={currency}
              />
            ) : (
              <Input
                id="oi-edit-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
            {/* Image #51: если доход частично получен — разбивка под полем. */}
            {income?.paid_amount_cents != null ? (
              <p className="num text-[11px] font-semibold text-amber-700">
                {t('income.other_form.partial_received', {
                  paid: formatCurrency(income.paid_amount_cents, currency),
                  remaining: formatCurrency(
                    Math.max(0, income.amount_cents - income.paid_amount_cents),
                    currency,
                  ),
                  defaultValue: 'Получено {{paid}} · осталось {{remaining}}',
                })}
              </p>
            ) : null}
          </div>

          {/* T16 — «Метод оплаты» (раньше «Способ оплаты»). Кассу выбирать
              не нужно — она определяется автоматически из mapping выбранного
              метода (payment_methods.cash_register_id), задаваемого в
              справочнике /settings/finance → Методы оплаты. */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('income.other_form.payment_method')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {paymentMethods.map((m) => {
                const active = paymentMethod === m.code
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (active) {
                        setPaymentMethod('')
                        setCashRegisterId('')
                      } else {
                        setPaymentMethod(m.code)
                        // Авто-привязка кассы из справочника метода.
                        setCashRegisterId(m.cash_register_id ?? '')
                      }
                    }}
                    className={cn(
                      'border-border h-9 rounded-md border px-3 text-xs font-semibold transition-colors',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-card hover:bg-muted/40',
                    )}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-date">{t('income.other_edit.date')}</Label>
            <Input
              id="oi-edit-date"
              type="date"
              value={incomeAt}
              onChange={(e) => setIncomeAt(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-comment">{t('income.other_form.comment')}</Label>
            <Input
              id="oi-edit-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('income.other_form.comment_placeholder')}
            />
          </div>

          <div className="border-border bg-muted/30 mt-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2">
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
                disabled={unlinking}
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
                onClick={() => setPickerOpen(true)}
                className="shrink-0"
              >
                <Link2 className="size-3.5" strokeWidth={2} />
                {t('banking.link_to_bank')}
              </Button>
            )}
          </div>
        </div>

        <LinkOtherIncomeToBankDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          salonId={salonId}
          currency={currency}
          otherIncome={{
            id: income.id,
            amount_cents: income.amount_cents,
            income_at: income.income_at,
            title:
              categories.find((c) => c.id === income.category_id)?.name ??
              t('income.other_form.title'),
          }}
        />

        <DialogFooter className="border-border shrink-0 justify-between border-t px-5 py-3 sm:justify-between">
          {readOnly ? (
            <p className="text-muted-foreground w-full text-center text-xs">
              ⚠ Просмотр без редактирования. Попроси администратора дать тебе права.
            </p>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={handleDelete}
                disabled={remove.isPending || update.isPending}
                className="text-destructive hover:text-destructive"
              >
                {t('common.delete')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={update.isPending}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={update.isPending}>
                  {update.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t('common.save')
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
