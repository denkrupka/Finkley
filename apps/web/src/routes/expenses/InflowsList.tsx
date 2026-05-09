import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowDownToLine, Banknote, Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useBankInflows } from '@/hooks/useBanking'
import { formatCurrency } from '@/lib/utils/format-currency'

type Props = {
  salonId: string
  period: { start: string; end: string }
  currency: string
}

/**
 * «Поступления» — credit-транзакции из всех подключённых банков за период.
 * Появляется на /expenses?view=inflows. Показывает дату, контрагента,
 * описание, сумму. Не редактируется — это сырой импорт из банка.
 *
 * Если банков не подключено — показываем CTA «Подключить банк» в settings.
 */
export function InflowsList({ salonId, period, currency }: Props) {
  const { t } = useTranslation()
  const { data: inflows = [], isLoading } = useBankInflows(salonId, period)

  const total = inflows.reduce((acc, x) => acc + x.amount_cents, 0)

  return (
    <div>
      <div className="border-border bg-card shadow-finsm rounded-lg border">
        <div className="border-border flex items-baseline justify-between border-b px-5 py-4">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('expenses.inflows.list_title')}
          </h2>
          <span className="text-muted-foreground text-xs">
            {inflows.length} {t('expenses.records')} ·{' '}
            <span className="text-brand-sage font-bold">{formatCurrency(total, currency)}</span>
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-muted/60 h-12 animate-pulse rounded-md" />
            ))}
          </div>
        ) : inflows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="bg-brand-teal-soft text-brand-teal-deep mx-auto grid size-12 place-items-center rounded-xl">
              <Banknote className="size-5" strokeWidth={1.7} />
            </div>
            <p className="text-muted-foreground mt-3 text-sm">{t('expenses.inflows.empty')}</p>
            <Link
              to={`/${salonId}/settings?tab=integrations`}
              className="text-primary mt-3 inline-block text-sm font-semibold hover:underline"
            >
              {t('expenses.inflows.cta_connect')}
            </Link>
          </div>
        ) : (
          <ul>
            {inflows.map((tx) => (
              <li
                key={tx.id}
                className="border-border grid grid-cols-[60px_1fr_auto] items-center gap-3 border-t px-5 py-3 first:border-t-0"
                style={{ borderLeftWidth: 3, borderLeftColor: '#2E9E6B' }}
              >
                <span className="num text-muted-foreground text-xs">
                  {format(new Date(tx.executed_at), 'd MMM', { locale: ru })}
                </span>
                <span className="min-w-0">
                  <span className="text-foreground truncate text-sm font-semibold">
                    {tx.counterparty || tx.description || t('expenses.inflows.no_description')}
                  </span>
                  <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                    <Building2 className="size-3" strokeWidth={1.7} />
                    {tx.bank_name ?? '—'}
                    {tx.account_iban ? (
                      <>
                        <span className="opacity-50">·</span>
                        <span className="num truncate">…{tx.account_iban.slice(-6)}</span>
                      </>
                    ) : null}
                  </span>
                  {tx.counterparty && tx.description && tx.counterparty !== tx.description ? (
                    <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                      {tx.description}
                    </span>
                  ) : null}
                </span>
                <span className="num text-brand-sage flex items-center gap-1 text-right text-sm font-bold">
                  <ArrowDownToLine className="size-3.5" strokeWidth={2} />+
                  {formatCurrency(tx.amount_cents, tx.currency || currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-muted-foreground mt-3 text-xs">{t('expenses.inflows.note')}</p>
    </div>
  )
}
