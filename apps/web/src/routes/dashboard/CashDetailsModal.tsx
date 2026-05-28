import { Banknote, Building2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useBankAccountBalances } from '@/hooks/useBanking'
import { useRegisterBalances } from '@/hooks/useCashTransfers'
import { useFinancialSettings } from '@/hooks/useFinancialSettings'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * T73 — модалка «Детали по кассам» открывается из KPI «Деньги на счетах»
 * на дашборде. Показывает плитки по каждой кассе из financial_settings:
 *
 *   - Cash касса (cash_kind='cash'): plan = текущий баланс по нашим
 *     проводкам (compute_all_register_balances). Факт совпадает с планом
 *     потому что мы сами ведём учёт.
 *   - Non-cash касса (cash_kind='non_cash'):
 *     * Если есть привязка к bank_account: ФАКТ = balance из bank_transactions
 *       (банк уже подтвердил поступления). ПЛАН = наш расчётный баланс.
 *       «Ожидается поступление = план - факт» — клиент заплатил картой,
 *       эквайринг ещё не провёл.
 *     * Если нет привязки: показываем только наш расчётный баланс (план).
 */
export function CashDetailsModal({
  open,
  onClose,
  salonId,
  currency,
}: {
  open: boolean
  onClose: () => void
  salonId: string
  currency: string
}) {
  const { t } = useTranslation()
  const { data: settings } = useFinancialSettings(salonId)
  const { data: registerBalances = [] } = useRegisterBalances(salonId)
  const { data: bankBalances = [] } = useBankAccountBalances(salonId)

  const balanceByRegister = new Map(registerBalances.map((b) => [b.register_id, b.balance_cents]))
  // Для каждого register_id — суммируем balance всех bank_accounts, привязанных
  // к нему (обычно 1:1, но 1:N тоже валидно).
  const bankFactByRegister = new Map<string, number>()
  for (const ba of bankBalances) {
    if (!ba.cash_register_id) continue
    bankFactByRegister.set(
      ba.cash_register_id,
      (bankFactByRegister.get(ba.cash_register_id) ?? 0) + ba.balance_cents,
    )
  }

  const registers = (settings?.cash_registers.items ?? []).filter((r) => !r.archived)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0">
        <DialogTitle className="border-border flex items-center justify-between border-b px-5 py-3 text-base font-bold">
          {t('dashboard.cash_details.title', { defaultValue: 'Деньги на счетах — детали' })}
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </DialogTitle>
        <div className="flex flex-col gap-4 p-5">
          {registers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('dashboard.cash_details.empty', {
                defaultValue: 'Кассы ещё не настроены. Зайди в Настройки → Справочники → Кассы.',
              })}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {registers.map((r) => {
                const isCash = r.cash_kind !== 'non_cash'
                const planCents = balanceByRegister.get(r.id) ?? 0
                const factCents = bankFactByRegister.get(r.id)
                const linked = factCents != null
                const expected = linked ? planCents - factCents : 0
                return (
                  <div
                    key={r.id}
                    className="border-border bg-card shadow-finsm flex flex-col gap-2.5 rounded-xl border p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
                          {isCash ? (
                            <Banknote
                              className="text-muted-foreground size-3.5"
                              strokeWidth={1.8}
                            />
                          ) : (
                            <Building2
                              className="text-muted-foreground size-3.5"
                              strokeWidth={1.8}
                            />
                          )}
                          {r.label}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-[10px] font-semibold uppercase tracking-wider">
                          {isCash
                            ? t('dashboard.cash_details.cash', { defaultValue: 'Наличные' })
                            : t('dashboard.cash_details.non_cash', {
                                defaultValue: 'Безналичные',
                              })}
                        </span>
                      </div>
                    </div>

                    <hr className="border-border/60" />

                    {linked && !isCash ? (
                      <>
                        <div>
                          <span className="text-muted-foreground text-[11px]">
                            {t('dashboard.cash_details.fact_bank', {
                              defaultValue: 'Факт (по банку)',
                            })}
                          </span>
                          <div className="num text-foreground text-lg font-bold leading-none">
                            {formatCurrency(factCents ?? 0, currency)}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-[11px]">
                            {t('dashboard.cash_details.plan', {
                              defaultValue: 'План (по нашим записям)',
                            })}
                          </span>
                          <div className="num text-muted-foreground text-sm font-semibold leading-none">
                            {formatCurrency(planCents, currency)}
                          </div>
                        </div>
                        {Math.abs(expected) > 100 ? (
                          <div
                            className={cn(
                              'rounded-md px-2 py-1.5 text-[11px] font-semibold',
                              expected > 0
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-rose-50 text-rose-700',
                            )}
                          >
                            {expected > 0
                              ? t('dashboard.cash_details.expected_incoming', {
                                  defaultValue: 'Ожидается поступление: {{amount}}',
                                  amount: formatCurrency(expected, currency),
                                })
                              : t('dashboard.cash_details.discrepancy', {
                                  defaultValue: 'Разница: банк показывает на {{amount}} больше',
                                  amount: formatCurrency(-expected, currency),
                                })}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div>
                        <span className="text-muted-foreground text-[11px]">
                          {t('dashboard.cash_details.balance', { defaultValue: 'Текущий баланс' })}
                        </span>
                        <div className="num text-foreground text-lg font-bold leading-none">
                          {formatCurrency(planCents, currency)}
                        </div>
                        {!isCash ? (
                          <p className="text-muted-foreground mt-1 text-[11px]">
                            {t('dashboard.cash_details.not_linked', {
                              defaultValue:
                                'Касса не связана с банк-счётом. Привяжи в /settings → Интеграции → Банкинг чтобы видеть факт.',
                            })}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
