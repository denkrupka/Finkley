import { Plus, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react'
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
  type CustomItem,
  type CustomPctItem,
  type FinancialSettings,
} from '@/hooks/useFinancialSettings'
import { useSalon } from '@/hooks/useSalons'

/**
 * «Параметры» в Финансах. По каждой группе:
 *   - набор preset-полей (рент, ZUS, налоги, …) — редактируемые
 *   - блок «Свои позиции»: add / edit / archive / restore
 *
 * При архивировании item помечается `active=false` — исторические расчёты
 * не теряют ссылку на названия.
 */

type FieldKind = 'money' | 'percent'

type FieldDef<S extends keyof FinancialSettings> = {
  path: keyof FinancialSettings[S]
  labelKey: string
  kind: FieldKind
}

type GroupDef<S extends keyof FinancialSettings = keyof FinancialSettings> = {
  section: S
  titleKey: string
  subtitleKey?: string
  /** Тип customs у этой секции — money (CustomItem) или percent (CustomPctItem) */
  customKind: FieldKind
  fields: FieldDef<S>[]
}

type AnyGroupDef =
  | GroupDef<'cash_registers'>
  | GroupDef<'fixed'>
  | GroupDef<'other_income'>
  | GroupDef<'variable'>
  | GroupDef<'taxes'>
  | GroupDef<'investments'>
  | GroupDef<'flows'>

const GROUPS = [
  {
    section: 'cash_registers',
    titleKey: 'settings.parameters.cash.title',
    subtitleKey: 'settings.parameters.cash.subtitle',
    customKind: 'money',
    fields: [
      { path: 'director_cents', labelKey: 'settings.parameters.cash.director', kind: 'money' },
      { path: 'safe_cents', labelKey: 'settings.parameters.cash.safe', kind: 'money' },
      { path: 'gotowka_cents', labelKey: 'settings.parameters.cash.gotowka', kind: 'money' },
      { path: 'bank_karta_cents', labelKey: 'settings.parameters.cash.bank_karta', kind: 'money' },
      {
        path: 'karta_terminal_cents',
        labelKey: 'settings.parameters.cash.karta_terminal',
        kind: 'money',
      },
    ],
  } as GroupDef<'cash_registers'>,
  {
    section: 'fixed',
    titleKey: 'settings.parameters.fixed.title',
    subtitleKey: 'settings.parameters.fixed.subtitle',
    customKind: 'money',
    fields: [
      {
        path: 'payroll_management_cents',
        labelKey: 'settings.parameters.fixed.payroll_management',
        kind: 'money',
      },
      {
        path: 'payroll_admin_cents',
        labelKey: 'settings.parameters.fixed.payroll_admin',
        kind: 'money',
      },
      { path: 'zus_cents', labelKey: 'settings.parameters.fixed.zus', kind: 'money' },
      { path: 'rent_cents', labelKey: 'settings.parameters.fixed.rent', kind: 'money' },
      {
        path: 'electricity_cents',
        labelKey: 'settings.parameters.fixed.electricity',
        kind: 'money',
      },
      { path: 'ad_budget_cents', labelKey: 'settings.parameters.fixed.ad_budget', kind: 'money' },
      { path: 'smm_cents', labelKey: 'settings.parameters.fixed.smm', kind: 'money' },
      { path: 'internet_cents', labelKey: 'settings.parameters.fixed.internet', kind: 'money' },
      {
        path: 'services_subscription_cents',
        labelKey: 'settings.parameters.fixed.services_subscription',
        kind: 'money',
      },
      { path: 'cleaning_cents', labelKey: 'settings.parameters.fixed.cleaning', kind: 'money' },
      { path: 'household_cents', labelKey: 'settings.parameters.fixed.household', kind: 'money' },
      { path: 'leasing_cents', labelKey: 'settings.parameters.fixed.leasing', kind: 'money' },
      {
        path: 'repair_equipment_cents',
        labelKey: 'settings.parameters.fixed.repair_equipment',
        kind: 'money',
      },
      {
        path: 'bank_services_cents',
        labelKey: 'settings.parameters.fixed.bank_services',
        kind: 'money',
      },
      { path: 'accounting_cents', labelKey: 'settings.parameters.fixed.accounting', kind: 'money' },
      { path: 'fuel_cents', labelKey: 'settings.parameters.fixed.fuel', kind: 'money' },
      { path: 'other_cents', labelKey: 'settings.parameters.fixed.other', kind: 'money' },
    ],
  } as GroupDef<'fixed'>,
  {
    section: 'other_income',
    titleKey: 'settings.parameters.other_income.title',
    subtitleKey: 'settings.parameters.other_income.subtitle',
    customKind: 'money',
    fields: [
      {
        path: 'monthly_cents',
        labelKey: 'settings.parameters.other_income.monthly',
        kind: 'money',
      },
    ],
  } as GroupDef<'other_income'>,
  {
    section: 'variable',
    titleKey: 'settings.parameters.variable.title',
    subtitleKey: 'settings.parameters.variable.subtitle',
    customKind: 'percent',
    fields: [
      {
        path: 'admin_payroll_pct',
        labelKey: 'settings.parameters.variable.admin_payroll',
        kind: 'percent',
      },
      {
        path: 'bank_commission_pct',
        labelKey: 'settings.parameters.variable.bank_commission',
        kind: 'percent',
      },
      {
        path: 'ad_budget_pct',
        labelKey: 'settings.parameters.variable.ad_budget',
        kind: 'percent',
      },
      { path: 'bonuses_pct', labelKey: 'settings.parameters.variable.bonuses', kind: 'percent' },
    ],
  } as GroupDef<'variable'>,
  {
    section: 'taxes',
    titleKey: 'settings.parameters.taxes.title',
    subtitleKey: 'settings.parameters.taxes.subtitle',
    customKind: 'money',
    fields: [
      { path: 'pit36_cents', labelKey: 'settings.parameters.taxes.pit36', kind: 'money' },
      { path: 'vat_cents', labelKey: 'settings.parameters.taxes.vat', kind: 'money' },
      { path: 'cit_cents', labelKey: 'settings.parameters.taxes.cit', kind: 'money' },
      { path: 'pit3_cents', labelKey: 'settings.parameters.taxes.pit3', kind: 'money' },
    ],
  } as GroupDef<'taxes'>,
  {
    section: 'investments',
    titleKey: 'settings.parameters.investments.title',
    subtitleKey: 'settings.parameters.investments.subtitle',
    customKind: 'money',
    fields: [
      {
        path: 'franchise_fee_cents',
        labelKey: 'settings.parameters.investments.franchise_fee',
        kind: 'money',
      },
      {
        path: 'first_rent_cents',
        labelKey: 'settings.parameters.investments.first_rent',
        kind: 'money',
      },
      {
        path: 'renovation_cents',
        labelKey: 'settings.parameters.investments.renovation',
        kind: 'money',
      },
      {
        path: 'equipment_cents',
        labelKey: 'settings.parameters.investments.equipment',
        kind: 'money',
      },
      {
        path: 'inventory_cents',
        labelKey: 'settings.parameters.investments.inventory',
        kind: 'money',
      },
      {
        path: 'furniture_cents',
        labelKey: 'settings.parameters.investments.furniture',
        kind: 'money',
      },
      {
        path: 'other_cents',
        labelKey: 'settings.parameters.investments.other',
        kind: 'money',
      },
    ],
  } as GroupDef<'investments'>,
  {
    section: 'flows',
    titleKey: 'settings.parameters.flows.title',
    subtitleKey: 'settings.parameters.flows.subtitle',
    customKind: 'money',
    fields: [
      { path: 'dividends_cents', labelKey: 'settings.parameters.flows.dividends', kind: 'money' },
      {
        path: 'owner_contributions_cents',
        labelKey: 'settings.parameters.flows.owner_contributions',
        kind: 'money',
      },
      {
        path: 'owner_loans_cents',
        labelKey: 'settings.parameters.flows.owner_loans',
        kind: 'money',
      },
      {
        path: 'other_loans_cents',
        labelKey: 'settings.parameters.flows.other_loans',
        kind: 'money',
      },
    ],
  } as GroupDef<'flows'>,
] satisfies ReadonlyArray<AnyGroupDef>

type AnyCustomItem = CustomItem | CustomPctItem
function isPct(item: AnyCustomItem): item is CustomPctItem {
  return (item as CustomPctItem).pct !== undefined
}

/** Нормализует legacy fixed.custom (monthly_cents) к amount_cents. */
function normalizeCustomMoney(
  list: Array<CustomItem & { monthly_cents?: number }> | undefined,
): CustomItem[] {
  if (!list) return []
  return list.map((it) => ({
    id: it.id,
    label: it.label,
    amount_cents:
      it.amount_cents !== undefined
        ? it.amount_cents
        : (((it as { monthly_cents?: number }).monthly_cents ?? 0) as number),
    active: it.active !== false,
  }))
}

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
    kind: FieldKind,
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
    kind: FieldKind,
  ): string {
    const v = draft[section][path] as unknown as number
    if (kind === 'money') return String((v ?? 0) / 100)
    return String(v ?? 0)
  }

  function setCustom<K extends keyof FinancialSettings>(section: K, next: AnyCustomItem[]) {
    setDraft((prev) => {
      const groupPrev = prev[section] as unknown as Record<string, unknown>
      return {
        ...prev,
        [section]: { ...groupPrev, custom: next },
      } as FinancialSettings
    })
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

      {GROUPS.map((group) => {
        const sectionData = draft[group.section] as unknown as Record<string, unknown>
        const rawCustom = (sectionData.custom ?? []) as AnyCustomItem[]
        const customList: AnyCustomItem[] =
          group.customKind === 'money'
            ? normalizeCustomMoney(rawCustom as Array<CustomItem & { monthly_cents?: number }>)
            : (rawCustom as CustomPctItem[])
        return (
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

            <CustomList
              section={group.section}
              kind={group.customKind}
              items={customList}
              currency={currency}
              onChange={(next) => setCustom(group.section, next)}
            />
          </section>
        )
      })}

      <div className="border-border bg-card shadow-finsm sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-lg border p-3">
        <p className="text-muted-foreground text-xs">{t('settings.parameters.save_hint')}</p>
        <Button type="submit" variant="primary" size="md" disabled={save.isPending}>
          {save.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}

function CustomList({
  section,
  kind,
  items,
  currency,
  onChange,
}: {
  section: keyof FinancialSettings
  kind: FieldKind
  items: AnyCustomItem[]
  currency: string
  onChange: (next: AnyCustomItem[]) => void
}) {
  const { t } = useTranslation()
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  function addItem() {
    const base = { id: crypto.randomUUID(), label: '', active: true }
    const next: AnyCustomItem =
      kind === 'money' ? { ...base, amount_cents: 0 } : { ...base, pct: 0 }
    onChange([...items, next])
  }

  function updateItem(id: string, patch: Partial<CustomItem & CustomPctItem>) {
    onChange(items.map((it) => (it.id === id ? ({ ...it, ...patch } as AnyCustomItem) : it)))
  }

  function archiveItem(id: string) {
    onChange(items.map((it) => (it.id === id ? ({ ...it, active: false } as AnyCustomItem) : it)))
  }

  function restoreItem(id: string) {
    onChange(items.map((it) => (it.id === id ? ({ ...it, active: true } as AnyCustomItem) : it)))
  }

  function deleteItem(id: string) {
    onChange(items.filter((it) => it.id !== id))
  }

  const active = items.filter((it) => it.active)
  const archived = items.filter((it) => !it.active)

  return (
    <div className="border-border mt-5 border-t pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {t('settings.parameters.custom_section.title')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addItem}
          data-testid={`add-custom-${section}`}
        >
          <Plus className="size-3.5" strokeWidth={2} />
          {t('settings.parameters.custom_section.add')}
        </Button>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          {t('settings.parameters.custom_section.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {active.map((it) => (
            <li key={it.id} className="border-border flex items-center gap-2 rounded-md border p-2">
              <Input
                value={it.label}
                onChange={(e) => updateItem(it.id, { label: e.target.value })}
                placeholder={t('settings.parameters.custom_section.label_placeholder')}
                className="h-9 flex-1 text-sm"
              />
              <div className="border-border bg-card flex h-9 w-28 items-center gap-1.5 rounded-md border px-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={isPct(it) ? String(it.pct ?? 0) : String((it.amount_cents ?? 0) / 100)}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(',', '.'))
                    if (!Number.isFinite(n) || n < 0) return
                    if (kind === 'percent') {
                      if (n > 100) return
                      updateItem(it.id, { pct: n })
                    } else {
                      updateItem(it.id, { amount_cents: Math.round(n * 100) })
                    }
                  }}
                  className="num h-full border-0 bg-transparent px-0 text-right text-sm shadow-none focus-visible:ring-0"
                />
                <span className="text-muted-foreground text-xs font-semibold">
                  {kind === 'money' ? currencySymbol : '%'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => archiveItem(it.id)}
                className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                title={t('settings.parameters.custom_section.archive')}
                aria-label={t('settings.parameters.custom_section.archive')}
              >
                <Trash2 className="size-3.5" strokeWidth={1.8} />
              </button>
            </li>
          ))}

          {archived.length > 0 ? (
            <details className="mt-2">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {t('settings.parameters.custom_section.archived', { count: archived.length })}
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {archived.map((it) => (
                  <li
                    key={it.id}
                    className="text-muted-foreground bg-muted/30 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs"
                  >
                    <span className="line-through">{it.label || '—'}</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => restoreItem(it.id)}
                        className="text-secondary inline-flex items-center gap-1 font-semibold hover:underline"
                      >
                        <Undo2 className="size-3" strokeWidth={2} />
                        {t('settings.parameters.custom_section.restore')}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteItem(it.id)}
                        className="hover:text-destructive font-semibold"
                        title={t('settings.parameters.custom_section.delete_permanent')}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </ul>
      )}

      <p className="text-muted-foreground mt-2 text-[11px]">
        {t('settings.parameters.custom_section.history_hint')}
      </p>
    </div>
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
  kind: FieldKind
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
