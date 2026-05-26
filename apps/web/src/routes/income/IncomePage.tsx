import { Briefcase, Landmark, ShoppingBag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { type OtherIncomeRow } from '@/hooks/useOtherIncomes'
import { useSalon } from '@/hooks/useSalons'
import { type VisitRow } from '@/hooks/useVisits'
import { BankingTransactionsTable } from '@/routes/banking/BankingTransactionsTable'
import { VisitsActionsBar } from '@/routes/visits/VisitsActionsBar'
import { VisitsPage } from '@/routes/visits/VisitsPage'

import { SalesTab } from './SalesTab'

type IncomeTab = 'visits' | 'sales' | 'banking'

// Image #42: tab «Прочие доходы» удалён — прочие доходы теперь добавляются
// прямо в wizard Продажи (вкладка «Прочие доходы» вместо «Другое»). Список
// прочих доходов виден в /finance → ДДС.
const TABS: PageTab<IncomeTab>[] = [
  { id: 'visits', labelKey: 'income.tabs.visits', icon: Briefcase },
  { id: 'sales', labelKey: 'income.tabs.sales', icon: ShoppingBag },
  { id: 'banking', labelKey: 'income.tabs.banking', icon: Landmark },
]

function isIncomeTab(v: string | null): v is IncomeTab {
  return v === 'visits' || v === 'sales' || v === 'banking'
}

type IncomePageProps = {
  /** Embedded режим — без header'а/padding, без таба «Банкинг», picker-callbacks. */
  embedded?: boolean
  /** Override salonId если не из URL (для embed). */
  pickerSalonId?: string
  /** Picker: клик по визиту → callback вместо VisitDetailModal. */
  onPickVisit?: (v: VisitRow) => void
  /** Picker: клик по other-income → callback вместо edit-modal. */
  onPickOtherIncome?: (o: OtherIncomeRow) => void
  /** Скрыть таб «Банкинг» (когда embed внутри LinkTransactionDialog credit). */
  hideBankingTab?: boolean
}

/**
 * Страница «Доходы» — таб-обёртка над тремя источниками выручки.
 * Image #54: убран h1+subtitle (дублировали навигационную хлебную крошку и
 * занимали место). Action-кнопки таба «Визиты» (Импорт CSV / list|calendar)
 * вынесены в rightSlot PageTabsNav.
 */
export function IncomePage({
  embedded = false,
  pickerSalonId,
  onPickVisit,
  onPickOtherIncome,
  hideBankingTab = false,
}: IncomePageProps = {}) {
  const { t } = useTranslation()
  const params_ = useParams<{ salonId: string }>()
  const salonId = pickerSalonId ?? params_.salonId
  const [params, setParams] = useSearchParams()
  const { data: salon } = useSalon(salonId)
  const [bankingPeriod, setBankingPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const bankingRange = useMemo(() => {
    const r = periodToRange(bankingPeriod)
    return { start: r.start.toISOString().slice(0, 10), end: r.end.toISOString().slice(0, 10) }
  }, [bankingPeriod])

  // Embedded: локальный state вместо URL params чтобы не дёргать history родителя.
  const [localTab, setLocalTab] = useState<IncomeTab>('visits')
  const tabParam = params.get('tab')
  const urlTab: IncomeTab = isIncomeTab(tabParam) ? tabParam : 'visits'
  const tabsToShow: PageTab<IncomeTab>[] = hideBankingTab
    ? TABS.filter((t) => t.id !== 'banking')
    : TABS
  let active: IncomeTab = embedded ? localTab : urlTab
  // Защита: если внешний URL имеет ?tab=banking но мы спрятали таб → fallback.
  if (active === 'banking' && hideBankingTab) active = 'visits'

  function setActive(id: IncomeTab) {
    if (id === 'banking' && hideBankingTab) return
    if (embedded) {
      setLocalTab(id)
      return
    }
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  if (!salonId) return null

  return (
    <div
      className={
        embedded ? 'flex flex-1 flex-col' : 'flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12'
      }
    >
      <PageTabsNav
        tabs={tabsToShow}
        active={active}
        onChange={setActive}
        t={t}
        rightSlot={
          active === 'visits' && !embedded ? (
            <VisitsActionsBar />
          ) : active === 'banking' ? (
            <PeriodPickerPopover value={bankingPeriod} onChange={setBankingPeriod} />
          ) : null
        }
      />

      {active === 'visits' ? (
        <VisitsPage
          forcedKind="visit"
          pickerSalonId={embedded ? salonId : undefined}
          onPickVisit={onPickVisit}
        />
      ) : active === 'sales' ? (
        <SalesTab
          salonId={salonId}
          onPickVisit={onPickVisit}
          onPickOtherIncome={onPickOtherIncome}
        />
      ) : (
        <BankingTransactionsTable
          salonId={salonId}
          direction="credit"
          period={bankingRange}
          currency={salon?.currency ?? 'PLN'}
        />
      )}
    </div>
  )
}
