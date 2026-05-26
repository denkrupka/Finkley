import { AlertTriangle, Landmark, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIncomePaymentInstallments } from '@/hooks/useIncomePaymentInstallments'
import type { OtherIncomeRow } from '@/hooks/useOtherIncomes'
import type { VisitRow } from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

type IncomeEntity = { kind: 'visit'; row: VisitRow } | { kind: 'other_income'; row: OtherIncomeRow }

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  salonId: string
  entity: IncomeEntity
  txAmount: number
  txCurrency: string
  txId: string
  txExecutedAt: string
  onLinked: (mode: 'partial' | 'full') => void
}

/**
 * Image #51 — частичные поступления для доходной стороны (visits + other_incomes).
 * Симметричный аналог PartiallyPaidExpenseDialog: список installments,
 * оплачено/осталось + опции «частично / изменить сумму / отмена».
 */
export function PartiallyPaidIncomeDialog({
  open,
  onOpenChange,
  entity,
  txAmount,
  txCurrency,
  txId,
  txExecutedAt,
  onLinked,
}: Props) {
  const { t } = useTranslation()
  const visitId = entity.kind === 'visit' ? entity.row.id : null
  const otherIncomeId = entity.kind === 'other_income' ? entity.row.id : null
  const { data: installments = [] } = useIncomePaymentInstallments({
    visit_id: visitId,
    other_income_id: otherIncomeId,
  })
  const [busy, setBusy] = useState<string | null>(null)

  const total =
    entity.kind === 'visit'
      ? entity.row.amount_cents - (entity.row.discount_cents ?? 0) + (entity.row.tip_cents ?? 0)
      : entity.row.amount_cents
  const alreadyPaid = entity.row.paid_amount_cents ?? 0
  const remaining = Math.max(0, total - alreadyPaid)
  const txEqualsRemaining = txAmount === remaining
  const txLessThanRemaining = txAmount < remaining

  async function createInstallmentAndLink(mode: 'partial' | 'full') {
    setBusy(mode)
    try {
      const { error: insErr } = await supabase.from('income_payment_installments').insert({
        visit_id: visitId,
        other_income_id: otherIncomeId,
        paid_at: txExecutedAt,
        amount_cents: txAmount,
        bank_transaction_id: txId,
        payment_method: 'transfer',
      })
      if (insErr) throw new Error(insErr.message)

      const linkUpdate: Record<string, unknown> = {
        expense_id: null,
        linked_visit_id: null,
        linked_other_income_id: null,
        needs_review: false,
      }
      if (visitId) linkUpdate.linked_visit_id = visitId
      else if (otherIncomeId) linkUpdate.linked_other_income_id = otherIncomeId

      const { error: linkErr } = await supabase
        .from('bank_transactions')
        .update(linkUpdate)
        .eq('id', txId)
      if (linkErr) throw new Error(linkErr.message)

      toast.success(
        mode === 'full'
          ? t('banking.partial_paid.toast_full_income', {
              defaultValue: 'Доход полностью получен',
            })
          : t('banking.partial_paid.toast_partial_income', {
              defaultValue: 'Привязано как частичное поступление',
            }),
      )
      onLinked(mode)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function adjustAmountAndLink() {
    setBusy('adjust')
    try {
      const newAmount = alreadyPaid + txAmount
      const table = entity.kind === 'visit' ? 'visits' : 'other_incomes'
      const { error: upErr } = await supabase
        .from(table)
        .update({ amount_cents: newAmount })
        .eq('id', entity.row.id)
      if (upErr) throw new Error(upErr.message)
      await createInstallmentAndLink('full')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const kindLabel =
    entity.kind === 'visit'
      ? t('banking.partial_paid.kind_visit', { defaultValue: 'визит' })
      : t('banking.partial_paid.kind_other_income', { defaultValue: 'доход' })

  const entityTitle =
    entity.kind === 'visit'
      ? (entity.row.service_name_snapshot ??
        t('banking.partial_paid.untitled_visit', { defaultValue: 'Визит' }))
      : (entity.row.comment ??
        t('banking.partial_paid.untitled_other_income', { defaultValue: 'Прочий доход' }))

  const entityDate = entity.kind === 'visit' ? entity.row.visit_at : entity.row.income_at

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col p-0">
        <div className="border-border shrink-0 border-b px-5 py-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600" strokeWidth={2} />
              {t('banking.partial_paid.title_income', {
                defaultValue: 'Привязка к частично полученному {{kind}}',
                kind: kindLabel,
              })}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {entityTitle} · {formatExpenseDate(entityDate)}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
          <div className="bg-muted/30 grid grid-cols-3 gap-3 rounded-md p-3 text-sm">
            <div>
              <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                {t('banking.partial_paid.total', { defaultValue: 'Всего' })}
              </p>
              <p className="num text-foreground font-bold">{formatCurrency(total, txCurrency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                {t('banking.partial_paid.paid', { defaultValue: 'Получено' })}
              </p>
              <p className="num font-bold text-emerald-700">
                {formatCurrency(alreadyPaid, txCurrency)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                {t('banking.partial_paid.remaining', { defaultValue: 'Осталось' })}
              </p>
              <p className="num font-bold text-amber-700">
                {formatCurrency(remaining, txCurrency)}
              </p>
            </div>
          </div>

          {installments.length > 0 ? (
            <div className="border-border rounded-md border">
              <div className="bg-muted/40 border-border border-b px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-900">
                {t('banking.partial_paid.history_income', {
                  defaultValue: 'История поступлений',
                })}
              </div>
              <ul>
                {installments.map((it) => (
                  <li
                    key={it.id}
                    className="border-border/60 grid grid-cols-[80px_1fr_auto] items-center gap-3 border-t px-3 py-2 text-sm first:border-t-0"
                  >
                    <span className="num text-muted-foreground text-xs">
                      {formatExpenseDate(it.paid_at)}
                    </span>
                    <span className="text-foreground flex items-center gap-1.5 text-xs">
                      {it.bank_transaction_id ? (
                        <>
                          <Landmark className="text-brand-teal-deep size-3" strokeWidth={2} />
                          {t('banking.partial_paid.via_bank', { defaultValue: 'Банк' })}
                        </>
                      ) : (
                        (it.payment_method ?? '—')
                      )}
                      {it.comment ? (
                        <span className="text-muted-foreground/70">· {it.comment}</span>
                      ) : null}
                    </span>
                    <span className="num text-foreground text-right text-xs font-bold">
                      {formatCurrency(it.amount_cents, txCurrency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-brand-teal/40 bg-brand-teal-soft/20 rounded-md border p-3">
            <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              {t('banking.partial_paid.current_tx', { defaultValue: 'Эта транзакция' })}
            </p>
            <p className="num text-brand-teal-deep mt-0.5 text-base font-bold">
              +{formatCurrency(txAmount, txCurrency)} · {formatExpenseDate(txExecutedAt)}
            </p>
            {txLessThanRemaining ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('banking.partial_paid.hint_less_income', {
                  defaultValue:
                    'Транзакция меньше остатка к доплате — её можно записать как частичное поступление или уменьшить сумму дохода с учётом разницы.',
                })}
              </p>
            ) : !txEqualsRemaining ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('banking.partial_paid.hint_more_income', {
                  defaultValue:
                    'Транзакция больше остатка — можно увеличить сумму дохода чтобы покрыть её полностью.',
                })}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-border shrink-0 flex-col gap-2 border-t px-5 py-3 sm:flex-col sm:items-stretch">
          {txEqualsRemaining ? (
            <Button
              variant="primary"
              onClick={() => createInstallmentAndLink('full')}
              disabled={!!busy}
              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
            >
              {busy === 'full' ? (
                <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
              ) : null}
              <span className="block">
                {t('banking.partial_paid.action_link_full_income', {
                  defaultValue: 'Привязать (полностью получен)',
                })}
              </span>
            </Button>
          ) : txLessThanRemaining ? (
            <>
              <Button
                variant="primary"
                onClick={() => createInstallmentAndLink('partial')}
                disabled={!!busy}
                className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
              >
                {busy === 'partial' ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
                ) : null}
                <span className="block">
                  {t('banking.partial_paid.action_partial_income', {
                    defaultValue: 'Записать как частичное поступление',
                  })}
                </span>
              </Button>
              <Button
                variant="outline"
                onClick={adjustAmountAndLink}
                disabled={!!busy}
                className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
              >
                {busy === 'adjust' ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
                ) : null}
                <span className="block">
                  {t('banking.partial_paid.action_adjust_down_income', {
                    defaultValue: 'Изменить сумму дохода (новая = {{new}}) — закрыть полностью',
                    new: formatCurrency(alreadyPaid + txAmount, txCurrency),
                  })}
                </span>
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={adjustAmountAndLink}
              disabled={!!busy}
              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
            >
              {busy === 'adjust' ? (
                <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
              ) : null}
              <span className="block">
                {t('banking.partial_paid.action_adjust_up_income', {
                  defaultValue:
                    'Увеличить сумму дохода до {{new}} — транзакция закроет его полностью',
                  new: formatCurrency(alreadyPaid + txAmount, txCurrency),
                })}
              </span>
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={!!busy}
            className="h-auto w-full justify-start whitespace-normal py-2 text-left"
          >
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
