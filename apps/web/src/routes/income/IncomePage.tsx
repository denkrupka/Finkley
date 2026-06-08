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
import { useTreatwellAutoSync } from '@/hooks/useIntegrations'
import { type OtherIncomeRow } from '@/hooks/useOtherIncomes'
import { toLocalISODate } from '@/lib/utils/format-date'
import { usePermissions } from '@/hooks/usePermissions'
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
  /** ID визита/прочего дохода уже связанного с открытой tx — подсветка. */
  highlightVisitId?: string | null
  highlightOtherIncomeId?: string | null
  /** Multi-select для multi-link (одна tx → N доходов). */
  multiSelectMode?: boolean
  selectedVisitIds?: Set<string>
  selectedOtherIncomeIds?: Set<string>
  onToggleVisitSelection?: (v: VisitRow) => void
  onToggleOtherIncomeSelection?: (o: OtherIncomeRow) => void
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
  highlightVisitId = null,
  highlightOtherIncomeId = null,
  multiSelectMode = false,
  selectedVisitIds,
  selectedOtherIncomeIds,
  onToggleVisitSelection,
  onToggleOtherIncomeSelection,
}: IncomePageProps = {}) {
  const { t } = useTranslation()
  const params_ = useParams<{ salonId: string }>()
  const salonId = pickerSalonId ?? params_.salonId
  const [params, setParams] = useSearchParams()
  const { data: salon } = useSalon(salonId)
  // Авто-синк Treatwell при открытии Доходов (как Booksy). One-shot, если
  // интеграция connected и интервал просрочен. Тихо, в фоне.
  useTreatwellAutoSync(salonId)
  const [bankingPeriod, setBankingPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const bankingRange = useMemo(() => {
    const r = periodToRange(bankingPeriod)
    // Локальная YYYY-MM-DD: иначе в Europe/Warsaw toISOString сдвигает
    // границу месяца на -2ч и фильтр захватывает последний день
    // предыдущего месяца. См. toLocalISODate.
    return { start: toLocalISODate(r.start), end: toLocalISODate(r.end) }
  }, [bankingPeriod])

  // Embedded: локальный state вместо URL params чтобы не дёргать history родителя.
  const [localTab, setLocalTab] = useState<IncomeTab>('visits')
  // Owner 04.06: поиск-фильтр в Банкинге.
  const [bankingSearchQ, setBankingSearchQ] = useState<string>('')
  const tabParam = params.get('tab')
  const urlTab: IncomeTab = isIncomeTab(tabParam) ? tabParam : 'visits'
  // T36 — per-tab permissions для income (visits/sales/banking).
  const { can } = usePermissions(salonId)
  const canViewVisits = can('income', 'visits')
  const canViewSales = can('income', 'sales')
  const canViewBanking = can('income', 'banking')
  const tabsToShow: PageTab<IncomeTab>[] = TABS.filter((t) => {
    if (t.id === 'banking' && (hideBankingTab || !canViewBanking)) return false
    if (t.id === 'visits' && !canViewVisits) return false
    if (t.id === 'sales' && !canViewSales) return false
    return true
  })
  let active: IncomeTab = embedded ? localTab : urlTab
  // Защита: если внешний URL имеет ?tab=banking но мы спрятали таб → fallback.
  if (active === 'banking' && (hideBankingTab || !canViewBanking)) active = 'visits'
  if (active === 'visits' && !canViewVisits) active = canViewSales ? 'sales' : 'banking'
  if (active === 'sales' && !canViewSales) active = canViewVisits ? 'visits' : 'banking'

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
          highlightVisitId={highlightVisitId}
          multiSelectMode={multiSelectMode}
          selectedVisitIds={selectedVisitIds}
          onToggleVisitSelection={onToggleVisitSelection}
        />
      ) : active === 'sales' ? (
        <SalesTab
          salonId={salonId}
          onPickVisit={onPickVisit}
          onPickOtherIncome={onPickOtherIncome}
          highlightVisitId={highlightVisitId}
          highlightOtherIncomeId={highlightOtherIncomeId}
          multiSelectMode={multiSelectMode}
          selectedVisitIds={selectedVisitIds}
          selectedOtherIncomeIds={selectedOtherIncomeIds}
          onToggleVisitSelection={onToggleVisitSelection}
          onToggleOtherIncomeSelection={onToggleOtherIncomeSelection}
        />
      ) : (
        <>
          {/* Owner 04.06: поиск в Банкинге — как в Расходах. */}
          <div className="mb-3 flex items-center gap-2">
            <input
              type="search"
              value={bankingSearchQ}
              onChange={(e) => setBankingSearchQ(e.target.value)}
              placeholder={t('income.banking_search_placeholder', {
                defaultValue: 'Поиск по контрагенту или назначению…',
              })}
              className="border-border bg-card placeholder:text-muted-foreground focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
            />
          </div>
          <BankingTransactionsTable
            salonId={salonId}
            direction="credit"
            period={bankingRange}
            currency={salon?.currency ?? 'PLN'}
            searchQ={bankingSearchQ}
          />
        </>
      )}
    </div>
  )
}
