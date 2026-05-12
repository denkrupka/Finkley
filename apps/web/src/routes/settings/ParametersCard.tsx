import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  useFinancialSettings,
  useUpdateFinancialSettings,
  type FinancialSettings,
} from '@/hooks/useFinancialSettings'
import { useSalon } from '@/hooks/useSalons'

/**
 * Вкладка «Параметры» в Настройках салона.
 * Вводные данные owner'а для финансовых расчётов:
 *   - стартовые остатки касс
 *   - постоянные расходы в месяц
 *   - переменные расходы (% от выручки)
 *   - прочие плановые доходы
 *   - налоги в месяц
 *   - плановые инвестиции
 *   - вложение/распределение денег
 *
 * Все суммы в локальной валюте salon.currency. Internally — bigint в центах.
 */

const GROUPS = [
  {
    titleKey: 'settings.parameters.cash.title',
    subtitleKey: 'settings.parameters.cash.subtitle',
    section: 'cash_registers' as const,
    fields: [
      {
        path: 'director_cents' as const,
        labelKey: 'settings.parameters.cash.director',
        kind: 'money' as const,
      },
      {
        path: 'safe_cents' as const,
        labelKey: 'settings.parameters.cash.safe',
        kind: 'money' as const,
      },
      {
        path: 'gotowka_cents' as const,
        labelKey: 'settings.parameters.cash.gotowka',
        kind: 'money' as const,
      },
      {
        path: 'bank_karta_cents' as const,
        labelKey: 'settings.parameters.cash.bank_karta',
        kind: 'money' as const,
      },
      {
        path: 'karta_terminal_cents' as const,
        labelKey: 'settings.parameters.cash.karta_terminal',
        kind: 'money' as const,
      },
    ],
  },
  {
    titleKey: 'settings.parameters.fixed.title',
    subtitleKey: 'settings.parameters.fixed.subtitle',
    section: 'fixed' as const,
    fields: [
      {
        path: 'payroll_management_cents' as const,
        labelKey: 'settings.parameters.fixed.payroll_management',
        kind: 'money' as const,
      },
      {
        path: 'payroll_admin_cents' as const,
        labelKey: 'settings.parameters.fixed.payroll_admin',
        kind: 'money' as const,
      },
      {
        path: 'zus_cents' as const,
        labelKey: 'settings.parameters.fixed.zus',
        kind: 'money' as const,
      },
      {
        path: 'rent_cents' as const,
        labelKey: 'settings.parameters.fixed.rent',
        kind: 'money' as const,
      },
      {
        path: 'electricity_cents' as const,
        labelKey: 'settings.parameters.fixed.electricity',
        kind: 'money' as const,
      },
      {
        path: 'ad_budget_cents' as const,
        labelKey: 'settings.parameters.fixed.ad_budget',
        kind: 'money' as const,
      },
      {
        path: 'smm_cents' as const,
        labelKey: 'settings.parameters.fixed.smm',
        kind: 'money' as const,
      },
      {
        path: 'internet_cents' as const,
        labelKey: 'settings.parameters.fixed.internet',
        kind: 'money' as const,
      },
      {
        path: 'services_subscription_cents' as const,
        labelKey: 'settings.parameters.fixed.services_subscription',
        kind: 'money' as const,
      },
      {
        path: 'cleaning_cents' as const,
        labelKey: 'settings.parameters.fixed.cleaning',
        kind: 'money' as const,
      },
      {
        path: 'household_cents' as const,
        labelKey: 'settings.parameters.fixed.household',
        kind: 'money' as const,
      },
      {
        path: 'leasing_cents' as const,
        labelKey: 'settings.parameters.fixed.leasing',
        kind: 'money' as const,
      },
      {
        path: 'repair_equipment_cents' as const,
        labelKey: 'settings.parameters.fixed.repair_equipment',
        kind: 'money' as const,
      },
      {
        path: 'bank_services_cents' as const,
        labelKey: 'settings.parameters.fixed.bank_services',
        kind: 'money' as const,
      },
      {
        path: 'accounting_cents' as const,
        labelKey: 'settings.parameters.fixed.accounting',
        kind: 'money' as const,
      },
      {
        path: 'fuel_cents' as const,
        labelKey: 'settings.parameters.fixed.fuel',
        kind: 'money' as const,
      },
      {
        path: 'other_cents' as const,
        labelKey: 'settings.parameters.fixed.other',
        kind: 'money' as const,
      },
    ],
  },
  {
    titleKey: 'settings.parameters.other_income.title',
    subtitleKey: 'settings.parameters.other_income.subtitle',
    section: 'other_income' as const,
    fields: [
      {
        path: 'monthly_cents' as const,
        labelKey: 'settings.parameters.other_income.monthly',
        kind: 'money' as const,
      },
    ],
  },
  {
    titleKey: 'settings.parameters.variable.title',
    subtitleKey: 'settings.parameters.variable.subtitle',
    section: 'variable' as const,
    fields: [
      {
        path: 'admin_payroll_pct' as const,
        labelKey: 'settings.parameters.variable.admin_payroll',
        kind: 'percent' as const,
      },
      {
        path: 'bank_commission_pct' as const,
        labelKey: 'settings.parameters.variable.bank_commission',
        kind: 'percent' as const,
      },
      {
        path: 'ad_budget_pct' as const,
        labelKey: 'settings.parameters.variable.ad_budget',
        kind: 'percent' as const,
      },
      {
        path: 'bonuses_pct' as const,
        labelKey: 'settings.parameters.variable.bonuses',
        kind: 'percent' as const,
      },
    ],
  },
  {
    titleKey: 'settings.parameters.taxes.title',
    subtitleKey: 'settings.parameters.taxes.subtitle',
    section: 'taxes' as const,
    fields: [
      {
        path: 'pit36_cents' as const,
        labelKey: 'settings.parameters.taxes.pit36',
        kind: 'money' as const,
      },
      {
        path: 'vat_cents' as const,
        labelKey: 'settings.parameters.taxes.vat',
        kind: 'money' as const,
      },
      {
        path: 'cit_cents' as const,
        labelKey: 'settings.parameters.taxes.cit',
        kind: 'money' as const,
      },
      {
        path: 'pit3_cents' as const,
        labelKey: 'settings.parameters.taxes.pit3',
        kind: 'money' as const,
      },
    ],
  },
  {
    titleKey: 'settings.parameters.investments.title',
    subtitleKey: 'settings.parameters.investments.subtitle',
    section: 'investments' as const,
    fields: [
      {
        path: 'franchise_fee_cents' as const,
        labelKey: 'settings.parameters.investments.franchise_fee',
        kind: 'money' as const,
      },
      {
        path: 'first_rent_cents' as const,
        labelKey: 'settings.parameters.investments.first_rent',
        kind: 'money' as const,
      },
      {
        path: 'renovation_cents' as const,
        labelKey: 'settings.parameters.investments.renovation',
        kind: 'money' as const,
      },
      {
        path: 'equipment_cents' as const,
        labelKey: 'settings.parameters.investments.equipment',
        kind: 'money' as const,
      },
      {
        path: 'inventory_cents' as const,
        labelKey: 'settings.parameters.investments.inventory',
        kind: 'money' as const,
      },
      {
        path: 'furniture_cents' as const,
        labelKey: 'settings.parameters.investments.furniture',
        kind: 'money' as const,
      },
      {
        path: 'other_cents' as const,
        labelKey: 'settings.parameters.investments.other',
        kind: 'money' as const,
      },
    ],
  },
  {
    titleKey: 'settings.parameters.flows.title',
    subtitleKey: 'settings.parameters.flows.subtitle',
    section: 'flows' as const,
    fields: [
      {
        path: 'dividends_cents' as const,
        labelKey: 'settings.parameters.flows.dividends',
        kind: 'money' as const,
      },
      {
        path: 'owner_contributions_cents' as const,
        labelKey: 'settings.parameters.flows.owner_contributions',
        kind: 'money' as const,
      },
      {
        path: 'owner_loans_cents' as const,
        labelKey: 'settings.parameters.flows.owner_loans',
        kind: 'money' as const,
      },
      {
        path: 'other_loans_cents' as const,
        labelKey: 'settings.parameters.flows.other_loans',
        kind: 'money' as const,
      },
    ],
  },
]

export function ParametersCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const { data: settings = DEFAULT_FINANCIAL_SETTINGS, isLoading } = useFinancialSettings(salonId)
  const save = useUpdateFinancialSettings(salonId)

  const [draft, setDraft] = useState<FinancialSettings>(settings)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  function setField<K extends keyof FinancialSettings, P extends keyof FinancialSettings[K]>(
    section: K,
    path: P,
    valueDisplay: string,
    kind: 'money' | 'percent',
  ) {
    const n = Number(valueDisplay.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return
    if (kind === 'percent' && n > 100) return
    const stored = kind === 'money' ? Math.round(n * 100) : n
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], [path]: stored },
    }))
  }

  function fieldDisplay<K extends keyof FinancialSettings, P extends keyof FinancialSettings[K]>(
    section: K,
    path: P,
    kind: 'money' | 'percent',
  ): string {
    const v = draft[section][path] as unknown as number
    if (kind === 'money') return String((v ?? 0) / 100)
    return String(v ?? 0)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    save.mutate(draft, {
      onSuccess: () => toast.success(t('settings.parameters.toast_saved')),
      onError: (err) =>
        toast.error(t('settings.parameters.toast_error'), {
          description: err instanceof Error ? err.message : String(err),
        }),
    })
  }

  if (isLoading) {
    return (
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </section>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="text-brand-teal size-5" strokeWidth={1.7} />
          <div>
            <h2 className="text-brand-navy text-lg font-bold tracking-tight">
              {t('settings.parameters.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('settings.parameters.subtitle')}
            </p>
          </div>
        </div>
      </div>

      {GROUPS.map((group) => (
        <section
          key={group.section}
          className="border-border bg-card shadow-finsm rounded-lg border p-5"
        >
          <header className="border-border mb-4 border-b pb-3">
            <h3 className="text-brand-navy text-base font-bold tracking-tight">
              {t(group.titleKey)}
            </h3>
            {group.subtitleKey ? (
              <p className="text-muted-foreground mt-0.5 text-xs">{t(group.subtitleKey)}</p>
            ) : null}
          </header>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.fields.map((field) => (
              <FieldRow
                key={String(field.path)}
                label={t(field.labelKey)}
                kind={field.kind}
                currency={currency}
                value={fieldDisplay(
                  group.section,
                  field.path as keyof FinancialSettings[typeof group.section],
                  field.kind,
                )}
                onChange={(v) =>
                  setField(
                    group.section,
                    field.path as keyof FinancialSettings[typeof group.section],
                    v,
                    field.kind,
                  )
                }
              />
            ))}
          </div>
        </section>
      ))}

      <div className="border-border bg-card shadow-finsm sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-lg border p-3">
        <p className="text-muted-foreground text-xs">{t('settings.parameters.save_hint')}</p>
        <Button type="submit" variant="primary" size="md" disabled={save.isPending}>
          {save.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}

function FieldRow({
  label,
  kind,
  currency,
  value,
  onChange,
}: {
  label: string
  kind: 'money' | 'percent'
  currency: string
  value: string
  onChange: (v: string) => void
}) {
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="border-border bg-card flex h-10 items-center gap-2 rounded-md border-[1.5px] px-3">
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="num h-full border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0"
        />
        <span className="text-muted-foreground text-xs font-semibold">
          {kind === 'money' ? currencySymbol : '%'}
        </span>
      </div>
    </div>
  )
}
