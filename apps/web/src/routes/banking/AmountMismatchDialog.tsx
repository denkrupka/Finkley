import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/utils/format-currency'

export type MismatchAction = 'partial' | 'adjust_amount' | 'cancel' | 'pick_multiple'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Сумма банковской tx (в копейках, всегда положительная). */
  txAmount: number
  /** Сумма расхода/визита/прочего дохода. */
  entityAmount: number
  /** Уже оплаченная часть расхода (если частичная); 0 если не частичный. */
  alreadyPaid?: number
  currency: string
  /** Тип сущности — определяет текст модалки. */
  entityKind: 'expense' | 'visit' | 'other_income'
  /** Вызывается с выбранной опцией. Для 'cancel' = просто закрыть. */
  onChoose: (action: MismatchAction) => void
  /** Spinner на кнопках во время mutation. */
  busy?: boolean
  /** Показывать ли опцию «Выбрать несколько» (image #43) — для debit-режима
   *  имеет смысл предложить multi-link если одна сущность не закрывает tx. */
  allowPickMultiple?: boolean
}

/**
 * Модалка предупреждения при несовпадении сумм tx и сущности
 * (owner-feedback 2026-05-26): юзер привязывает банковскую транзакцию к
 * расходу/доходу с другой суммой — нужно явно подтвердить намерение.
 *
 * Сценарии:
 *  - tx < entity → 3 опции: «Частичная оплата» (записать tx как часть,
 *    остаток в «Не оплачено»), «Изменить сумму» (привести entity к tx),
 *    «Отмена».
 *  - tx > entity → 2 опции: «Изменить сумму» (увеличить entity до tx),
 *    «Отмена». «Частичной оплаты» нет — переплату не моделируем.
 *  - Если entity уже частично оплачена, suma уже-оплачено + tx тоже могут
 *    превысить entity.amount — обрабатывается как «tx > remaining».
 */
export function AmountMismatchDialog({
  open,
  onOpenChange,
  txAmount,
  entityAmount,
  alreadyPaid = 0,
  currency,
  entityKind,
  onChoose,
  busy = false,
  allowPickMultiple = false,
}: Props) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<MismatchAction | null>(null)

  const remaining = Math.max(0, entityAmount - alreadyPaid)
  // Сравниваем tx с **остатком** к доплате, не с total.amount — для частично
  // оплаченных это критично: paid=50 + tx=70 на entity=100 → tx > remaining(50).
  const txEqualsRemaining = txAmount === remaining
  // tx меньше остатка → можно частичная или изменение суммы (3 опции).
  // tx больше остатка → только изменение или отмена (2 опции, переплату не моделируем).
  const txLessThanRemaining = txAmount < remaining

  if (txEqualsRemaining) {
    // Не должны были оказаться здесь — caller проверил mismatch. Защита.
    onChoose('partial')
    return null
  }

  const kindLabel = t(`banking.mismatch.kind_${entityKind}`, {
    defaultValue: entityKind === 'expense' ? 'расход' : entityKind === 'visit' ? 'визит' : 'доход',
  })

  function pick(action: MismatchAction) {
    setPending(action)
    onChoose(action)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-600" strokeWidth={2} />
            {t('banking.mismatch.title', { defaultValue: 'Суммы не совпадают' })}
          </DialogTitle>
          <DialogDescription>
            {txLessThanRemaining
              ? t('banking.mismatch.tx_less', {
                  defaultValue:
                    'Транзакция {{tx}} меньше чем {{kind}} {{entity}} (остаток к доплате {{remaining}}).',
                  tx: formatCurrency(txAmount, currency),
                  entity: formatCurrency(entityAmount, currency),
                  remaining: formatCurrency(remaining, currency),
                  kind: kindLabel,
                })
              : t('banking.mismatch.tx_more', {
                  defaultValue:
                    'Транзакция {{tx}} больше чем остаток к доплате по {{kind}} ({{remaining}}).',
                  tx: formatCurrency(txAmount, currency),
                  remaining: formatCurrency(remaining, currency),
                  kind: kindLabel,
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/30 grid grid-cols-2 gap-3 rounded-md p-3 text-sm">
          <div>
            <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              {t('banking.mismatch.tx_label', { defaultValue: 'Транзакция' })}
            </p>
            <p className="num text-foreground font-bold">{formatCurrency(txAmount, currency)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              {alreadyPaid > 0
                ? t('banking.mismatch.entity_remaining_label', { defaultValue: 'Остаток' })
                : t('banking.mismatch.entity_label', {
                    defaultValue: 'Сумма {{kind}}',
                    kind: kindLabel,
                  })}
            </p>
            <p className="num text-foreground font-bold">{formatCurrency(remaining, currency)}</p>
            {alreadyPaid > 0 ? (
              <p className="text-muted-foreground/80 num mt-0.5 text-[10px]">
                {t('banking.mismatch.already_paid_hint', {
                  defaultValue: 'из {{total}} (оплачено {{paid}})',
                  total: formatCurrency(entityAmount, currency),
                  paid: formatCurrency(alreadyPaid, currency),
                })}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          {txLessThanRemaining ? (
            <Button
              variant="primary"
              onClick={() => pick('partial')}
              disabled={busy}
              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
            >
              {pending === 'partial' && busy ? (
                <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
              ) : null}
              <span className="block">
                {t('banking.mismatch.action_partial', {
                  defaultValue: 'Записать как частичную оплату (остаток в «Не оплачено»)',
                })}
              </span>
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => pick('adjust_amount')}
            disabled={busy}
            className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
          >
            {pending === 'adjust_amount' && busy ? (
              <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
            ) : null}
            <span className="block">
              {txLessThanRemaining
                ? t('banking.mismatch.action_adjust_down', {
                    defaultValue: 'Изменить сумму {{kind}} на {{tx}} (полностью оплачено)',
                    tx: formatCurrency(txAmount, currency),
                    kind: kindLabel,
                  })
                : t('banking.mismatch.action_adjust_up', {
                    defaultValue: 'Увеличить сумму {{kind}} до {{tx}}',
                    tx: formatCurrency(txAmount, currency),
                    kind: kindLabel,
                  })}
            </span>
          </Button>
          {allowPickMultiple ? (
            <Button
              variant="outline"
              onClick={() => pick('pick_multiple')}
              disabled={busy}
              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
            >
              <span className="block">
                {t('banking.mismatch.action_pick_multiple', {
                  defaultValue: 'Выбрать несколько {{kind}}ов для этой транзакции',
                  kind: kindLabel,
                })}
              </span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => pick('cancel')}
            disabled={busy}
            className="h-auto w-full justify-start whitespace-normal py-2 text-left"
          >
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
