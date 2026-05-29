import { ArrowRight, Banknote, Building2, Link2Off } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useBankAccountBalances } from '@/hooks/useBanking'
import { useRegisterBalances } from '@/hooks/useCashTransfers'
import { useFinancialSettings } from '@/hooks/useFinancialSettings'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * T73/T87 — модалка «Детали по кассам» открывается из KPI «Деньги на счетах»
 * на дашборде.
 *
 * Структура для каждой кассы:
 *   - Cash (cash_kind='cash'): один баланс = текущий по нашим проводкам
 *     (compute_all_register_balances). Факт = план, мы сами ведём учёт.
 *   - Non-cash со связью bank_account: ФАКТ из bank_transactions + ПЛАН +
 *     «Ожидается поступление = план - факт» (картой заплатили, эквайринг
 *     ещё не провёл).
 *   - Non-cash БЕЗ связи: только наш расчётный план + явный CTA на привязку
 *     bank_account → cash_register в /settings → Интеграции → Банкинг.
 *
 * Кнопку закрытия (X) рисует shadcn DialogContent сам в правом верхнем
 * углу — свою НЕ добавляем (был дубль в первой версии).
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

  // Подсказка про не-связанную безналичную кассу — есть ли вообще
  // подключенные банк-аккаунты? Если есть, но эта касса не связана — у
  // юзера всё готово, нужен один клик связать. Если банка нет вообще —
  // другой CTA (подключить банк).
  const hasAnyBankAccount = bankBalances.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:!w-[min(1024px,96vw)] sm:!max-w-[1024px]">
        <DialogHeader>
          <DialogTitle>{t('dashboard.cash_details.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          {registers.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('dashboard.cash_details.empty')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {registers.map((r) => {
                const isCash = r.cash_kind !== 'non_cash'
                const planCents = balanceByRegister.get(r.id) ?? 0
                const factCents = bankFactByRegister.get(r.id)
                const linked = factCents != null
                const expected = linked ? planCents - factCents : 0
                return (
                  <div
                    key={r.id}
                    className="border-border bg-card shadow-finsm flex flex-col gap-3 rounded-xl border p-5"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'grid size-10 shrink-0 place-items-center rounded-lg',
                          isCash
                            ? 'bg-brand-sage-soft text-brand-sage-deep'
                            : 'bg-brand-teal-soft text-brand-teal-deep',
                        )}
                      >
                        {isCash ? (
                          <Banknote className="size-5" strokeWidth={1.8} />
                        ) : (
                          <Building2 className="size-5" strokeWidth={1.8} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {/* Mobile audit (2026-05-30): line-clamp-2 +
                            break-words чтобы длинные имена касс не
                            обрезались как «...» на iPhone (≤414px).
                            Заголовок мог быть «Karta terminala (BLIK + EMV)». */}
                        <p className="text-foreground line-clamp-2 break-words text-base font-bold leading-tight">
                          {r.label}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          {isCash
                            ? t('dashboard.cash_details.cash')
                            : t('dashboard.cash_details.non_cash')}
                        </p>
                      </div>
                    </div>

                    <hr className="border-border/60" />

                    {linked && !isCash ? (
                      <>
                        <div>
                          <span className="text-muted-foreground text-xs">
                            {t('dashboard.cash_details.fact_bank')}
                          </span>
                          <div className="num text-foreground mt-0.5 break-all text-xl font-bold leading-tight">
                            {formatCurrency(factCents ?? 0, currency)}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">
                            {t('dashboard.cash_details.plan')}
                          </span>
                          <div className="num text-muted-foreground mt-0.5 break-all text-sm font-semibold leading-tight">
                            {formatCurrency(planCents, currency)}
                          </div>
                        </div>
                        {Math.abs(expected) > 100 ? (
                          <div
                            className={cn(
                              'rounded-md px-2.5 py-2 text-xs font-semibold leading-snug',
                              expected > 0
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-rose-50 text-rose-700',
                            )}
                          >
                            {expected > 0
                              ? t('dashboard.cash_details.expected_incoming', {
                                  amount: formatCurrency(expected, currency),
                                })
                              : t('dashboard.cash_details.discrepancy', {
                                  amount: formatCurrency(-expected, currency),
                                })}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-muted-foreground text-xs">
                            {t('dashboard.cash_details.balance')}
                          </span>
                          <div className="num text-foreground mt-0.5 break-all text-xl font-bold leading-tight">
                            {formatCurrency(planCents, currency)}
                          </div>
                        </div>
                        {!isCash ? (
                          <UnlinkedHint salonId={salonId} hasAnyBankAccount={hasAnyBankAccount} />
                        ) : null}
                      </>
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

/** Подсказка для безналичной кассы без привязки к банк-аккаунту.
 *  Два сценария:
 *    - У салона есть подключенный банк, но эта касса не связана с конкретным
 *      счётом → «Связь не настроена» + кнопка «Связать сейчас».
 *    - Банк не подключен вообще → «Подключи банк чтобы видеть факт».
 */
function UnlinkedHint({
  salonId,
  hasAnyBankAccount,
}: {
  salonId: string
  hasAnyBankAccount: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="border-border bg-muted/30 flex flex-col gap-2 rounded-md border border-dashed p-2.5">
      <div className="text-muted-foreground inline-flex items-start gap-1.5 text-[11px] leading-snug">
        <Link2Off className="mt-0.5 size-3 shrink-0" strokeWidth={1.8} />
        <span>
          {hasAnyBankAccount
            ? t('dashboard.cash_details.unlinked_with_bank')
            : t('dashboard.cash_details.unlinked_no_bank')}
        </span>
      </div>
      <Link
        to={`/${salonId}/settings?tab=integrations&intab=banking`}
        className="text-brand-teal-deep hover:bg-brand-teal-soft/40 inline-flex items-center gap-1 self-start rounded px-1 py-0.5 text-[11px] font-bold"
      >
        {hasAnyBankAccount
          ? t('dashboard.cash_details.link_now')
          : t('dashboard.cash_details.connect_bank')}
        <ArrowRight className="size-3" strokeWidth={2.2} />
      </Link>
    </div>
  )
}
