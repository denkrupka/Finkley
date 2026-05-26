import { Link2, Loader2 } from 'lucide-react'
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

export type ConflictAction = 'rebind' | 'pick_another' | 'cancel'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Тип сущности для текста сообщения. */
  entityKind: 'expense' | 'visit' | 'other_income'
  /** Spinner на кнопках во время mutation. */
  busy?: boolean
  onChoose: (action: ConflictAction) => void
}

/**
 * Конфликт привязки: выбранная сущность уже связана с другой банковской tx
 * (image #45). Юзер выбирает: перепривязать или вернуться к picker.
 */
export function LinkConflictDialog({
  open,
  onOpenChange,
  entityKind,
  busy = false,
  onChoose,
}: Props) {
  const { t } = useTranslation()
  const kindLabel = t(`banking.mismatch.kind_${entityKind}`, {
    defaultValue: entityKind === 'expense' ? 'расход' : entityKind === 'visit' ? 'визит' : 'доход',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-5 text-amber-600" strokeWidth={2} />
            {t('banking.conflict.title', { defaultValue: 'Уже связан с другой транзакцией' })}
          </DialogTitle>
          <DialogDescription>
            {t('banking.conflict.body', {
              defaultValue:
                'Этот {{kind}} уже связан с другой банковской транзакцией. Отменить предыдущую связь и привязать к текущей транзакции?',
              kind: kindLabel,
            })}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          <Button
            variant="primary"
            onClick={() => onChoose('rebind')}
            disabled={busy}
            className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
          >
            {busy ? <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} /> : null}
            <span className="block">
              {t('banking.conflict.action_rebind', {
                defaultValue: 'Отменить предыдущую связь и привязать к текущей транзакции',
              })}
            </span>
          </Button>
          <Button
            variant="outline"
            onClick={() => onChoose('pick_another')}
            disabled={busy}
            className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
          >
            <span className="block">
              {t('banking.conflict.action_pick_another', {
                defaultValue: 'Выбрать другой {{kind}}',
                kind: kindLabel,
              })}
            </span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => onChoose('cancel')}
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
