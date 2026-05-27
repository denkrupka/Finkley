import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
  usePaymentMethods,
  useUpdatePaymentMethod,
  type PaymentMethodRow,
} from '@/hooks/usePaymentMethods'

type Draft = {
  id: string
  label: string
  cash_register_id: string | null
  commission_pct: number
  is_archived: boolean
}

/**
 * Справочник методов оплаты. Каждый метод привязан к одной кассе
 * (cash_register_id) — при оплате этим методом средства зачисляются на эту
 * кассу автоматически. commission_pct → авто-расход в категории «Комиссии».
 *
 * code (cash/card/transfer/online/mixed) менять нельзя — это enum, на нём
 * висит аналитика. Можно: переименовать label, поменять привязку кассы,
 * задать комиссию, архивировать (скрыть из выпадающих).
 */
export function PaymentMethodsCard({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: methods = [], isLoading } = usePaymentMethods(salonId, { includeArchived: true })
  const { data: cashRegisters = [] } = useCashRegisters(salonId)
  const update = useUpdatePaymentMethod(salonId)

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  useEffect(() => {
    const next: Record<string, Draft> = {}
    for (const m of methods) {
      next[m.id] = {
        id: m.id,
        label: m.label,
        cash_register_id: m.cash_register_id,
        commission_pct: m.commission_pct,
        is_archived: m.is_archived,
      }
    }
    setDrafts(next)
  }, [methods])

  function patchDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }))
  }

  function isDirty(m: PaymentMethodRow): boolean {
    const d = drafts[m.id]
    if (!d) return false
    return (
      d.label !== m.label ||
      (d.cash_register_id ?? null) !== (m.cash_register_id ?? null) ||
      d.commission_pct !== m.commission_pct ||
      d.is_archived !== m.is_archived
    )
  }

  function handleSave(m: PaymentMethodRow) {
    const d = drafts[m.id]
    if (!d) return
    update.mutate(
      {
        id: m.id,
        label: d.label.trim() || m.label,
        cash_register_id: d.cash_register_id,
        commission_pct: d.commission_pct,
        is_archived: d.is_archived,
      },
      {
        onSuccess: () => toast.success(t('common.save')),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  if (isLoading) {
    return (
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </section>
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
      <header className="border-border bg-muted/20 border-b px-5 py-3">
        <h3 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.payment_methods.title', { defaultValue: 'Методы оплаты' })}
        </h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('settings.payment_methods.subtitle', {
            defaultValue:
              'Привязка метода к кассе и опциональная комиссия. При оплате с комиссией создаётся расход в категории «Комиссии».',
          })}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/10 text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">
                {t('settings.payment_methods.col_label', { defaultValue: 'Название' })}
              </th>
              <th className="w-40 px-4 py-2 text-left font-semibold">
                {t('settings.payment_methods.col_kind', { defaultValue: 'Тип средств' })}
              </th>
              <th className="w-56 px-4 py-2 text-left font-semibold">
                {t('settings.payment_methods.col_register', { defaultValue: 'Касса' })}
              </th>
              <th className="w-32 px-4 py-2 text-left font-semibold">
                {t('settings.payment_methods.col_commission', { defaultValue: 'Комиссия, %' })}
              </th>
              <th className="w-28 px-4 py-2 text-right font-semibold" />
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => {
              const d = drafts[m.id]
              if (!d) return null
              const dirty = isDirty(m)
              // Тип средств = cash_kind кассы (если привязана), иначе по code.
              const reg = cashRegisters.find((r) => r.id === d.cash_register_id)
              void reg
              const isCash = m.code === 'cash'
              return (
                <tr key={m.id} className="border-border/60 border-t">
                  <td className="px-4 py-2">
                    <Input
                      value={d.label}
                      onChange={(e) => patchDraft(m.id, { label: e.target.value })}
                      disabled={d.is_archived}
                      className="h-9"
                    />
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">
                    {isCash
                      ? t('settings.parameters.cash_kind.cash', { defaultValue: 'Наличные' })
                      : t('settings.parameters.cash_kind.non_cash', {
                          defaultValue: 'Безналичные',
                        })}
                  </td>
                  <td className="px-4 py-2">
                    <Select
                      value={d.cash_register_id ?? '__none__'}
                      onValueChange={(v) =>
                        patchDraft(m.id, { cash_register_id: v === '__none__' ? null : v })
                      }
                      disabled={d.is_archived}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue
                          placeholder={t('settings.payment_methods.register_none', {
                            defaultValue: 'Не задано',
                          })}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {t('settings.payment_methods.register_none', {
                            defaultValue: 'Не задано',
                          })}
                        </SelectItem>
                        {cashRegisters.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="100"
                      value={d.commission_pct}
                      onChange={(e) =>
                        patchDraft(m.id, {
                          commission_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      disabled={d.is_archived}
                      className="num h-9 text-right"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {!m.is_system ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => patchDraft(m.id, { is_archived: !d.is_archived })}
                          title={
                            d.is_archived
                              ? t('common.restore', { defaultValue: 'Восстановить' })
                              : t('common.archive', { defaultValue: 'Архивировать' })
                          }
                        >
                          {d.is_archived
                            ? t('common.restore', { defaultValue: 'Восст.' })
                            : t('common.archive', { defaultValue: 'Архив' })}
                        </Button>
                      ) : null}
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSave(m)}
                        disabled={!dirty || update.isPending}
                      >
                        {update.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                        ) : null}
                        {t('common.save')}
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
