import { Calculator, Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useAccountingSettings,
  useUpdateAccountingSettings,
  type AccountingSettings,
} from '@/hooks/useAccountingSettings'
import { lookupNip } from '@/hooks/useCounterparties'
import { useSalonIntegrations } from '@/hooks/useIntegrations'
import {
  LEGAL_FORMS,
  getLegalForm,
  getTaxForm,
  inferLegalFormFromName,
} from '@/lib/accounting/forms'

/**
 * AccountingSettingsCard — блок «Бухгалтерия» во вкладке Settings → Профиль
 * (image #122).
 *
 * Что юзер настраивает:
 *   1. Юр. данные компании: NIP (с lookup'ом через MF White List API),
 *      название, адрес, флаг VAT, правная форма (JDG/Sp. z o.o./...).
 *   2. Форма налогообложения (зависит от правной формы) + ставка
 *      (если ставок несколько — даём выбрать).
 *   3. Доставка документов бухгалтеру: через порталы (выбор из
 *      интеграций, если нет в списке — текст «other» с обещанием добавить)
 *      или email.
 *
 * Если выбран канал email — справа всплывает hint: создайте бухгалтерскому
 * аккаунту email в «Пользователях», портал будет сам слать ему расходы.
 */

import { ACCOUNTING_PORTAL_OPTIONS as PORTAL_OPTIONS } from '@/lib/integrations/portals'

export function AccountingSettingsCard({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: settings, isLoading } = useAccountingSettings(salonId)
  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const save = useUpdateAccountingSettings(salonId)

  const [draft, setDraft] = useState<AccountingSettings>({})
  const [nipLookupPending, setNipLookupPending] = useState(false)

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  function patch<K extends keyof AccountingSettings>(key: K, value: AccountingSettings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const legal = getLegalForm(draft.legal_form)
  const tax = getTaxForm(draft.legal_form, draft.tax_form)

  // Когда меняется правная форма — сбрасываем форму налогообложения, если
  // она недоступна. То же со ставкой.
  useEffect(() => {
    if (!legal) return
    if (draft.tax_form && !legal.tax_forms.some((f) => f.value === draft.tax_form)) {
      setDraft((prev) => ({ ...prev, tax_form: undefined, tax_rate: undefined }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.legal_form])

  useEffect(() => {
    if (!tax) return
    if (
      draft.tax_rate != null &&
      tax.rates.length > 0 &&
      !tax.rates.some((r) => r.value === draft.tax_rate)
    ) {
      setDraft((prev) => ({ ...prev, tax_rate: undefined }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.tax_form])

  async function runNipLookup() {
    const nip = (draft.nip ?? '').replace(/[^0-9]/g, '')
    if (nip.length !== 10) {
      toast.error(t('counterparties.nip_invalid'))
      return
    }
    setNipLookupPending(true)
    try {
      const res = await lookupNip(nip)
      if (!res) {
        toast.info(t('counterparties.nip_not_found'))
        return
      }
      // Image #134: пытаемся также вытянуть правную форму из названия
      // (MF не возвращает её отдельно). Заполняем только если у юзера
      // ещё не выбрана форма руками — он сможет потом изменить.
      const inferred = inferLegalFormFromName(res.name)
      setDraft((prev) => ({
        ...prev,
        nip,
        company_name: prev.company_name || res.name,
        address: prev.address || res.address,
        legal_form: prev.legal_form || inferred || prev.legal_form,
      }))
      toast.success(t('counterparties.nip_found'))
    } catch (err) {
      toast.error(t('counterparties.nip_lookup_failed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setNipLookupPending(false)
    }
  }

  function handleSave() {
    save.mutate(draft, {
      onSuccess: () => toast.success(t('settings.accounting.toast_saved')),
      onError: (err) =>
        toast.error(t('settings.accounting.toast_error'), {
          description: err instanceof Error ? err.message : String(err),
        }),
    })
  }

  const portalIntegrationProvider = useMemo(() => {
    const opt = PORTAL_OPTIONS.find((p) => p.value === draft.portal)
    return opt?.integration_provider ?? null
  }, [draft.portal])

  const portalIsConnected = useMemo(() => {
    if (!portalIntegrationProvider) return false
    return integrations.some(
      (i) => i.provider === portalIntegrationProvider && i.status === 'connected',
    )
  }, [integrations, portalIntegrationProvider])

  const showEmailHint = draft.document_delivery === 'email' || draft.document_delivery === 'both'

  if (isLoading) {
    return (
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="bg-muted/40 h-32 animate-pulse rounded-md" />
      </section>
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Calculator className="text-brand-navy size-4" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.accounting.title')}
        </h2>
      </div>
      <p className="text-muted-foreground mb-5 text-sm">{t('settings.accounting.subtitle')}</p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* NIP + lookup */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="acc-nip">{t('settings.accounting.nip_label')}</Label>
          <div className="flex gap-2">
            <Input
              id="acc-nip"
              value={draft.nip ?? ''}
              onChange={(e) => patch('nip', e.target.value)}
              placeholder="0000000000"
              inputMode="numeric"
              maxLength={13}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={runNipLookup}
              disabled={nipLookupPending}
            >
              {nipLookupPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <Search className="size-4" strokeWidth={1.8} />
              )}
              {t('counterparties.nip_lookup')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t('settings.accounting.nip_hint')}</p>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="acc-name">{t('settings.accounting.company_name_label')}</Label>
          <Input
            id="acc-name"
            value={draft.company_name ?? ''}
            onChange={(e) => patch('company_name', e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="acc-address">{t('settings.accounting.address_label')}</Label>
          <Input
            id="acc-address"
            value={draft.address ?? ''}
            onChange={(e) => patch('address', e.target.value)}
          />
        </div>

        {/* VAT payer */}
        <div className="flex flex-col gap-1.5">
          <Label>{t('settings.accounting.vat_label')}</Label>
          <div className="flex gap-2">
            {(
              [
                { value: true, label: t('settings.accounting.vat_yes') },
                { value: false, label: t('settings.accounting.vat_no') },
              ] as const
            ).map((opt) => {
              const active = draft.vat_payer === opt.value
              return (
                <button
                  type="button"
                  key={String(opt.value)}
                  onClick={() => patch('vat_payer', opt.value)}
                  className={`h-10 flex-1 rounded-md border-[1.5px] text-sm font-semibold transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Legal form */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-legal">{t('settings.accounting.legal_form_label')}</Label>
          <Select value={draft.legal_form ?? ''} onValueChange={(v) => patch('legal_form', v)}>
            <SelectTrigger id="acc-legal">
              <SelectValue placeholder={t('settings.accounting.legal_form_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {LEGAL_FORMS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tax form (depends on legal form) */}
        {legal && legal.tax_forms.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="acc-tax">{t('settings.accounting.tax_form_label')}</Label>
            <Select value={draft.tax_form ?? ''} onValueChange={(v) => patch('tax_form', v)}>
              <SelectTrigger id="acc-tax">
                <SelectValue placeholder={t('settings.accounting.tax_form_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {legal.tax_forms.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {/* Tax rate (depends on tax form) */}
        {tax && tax.rates.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="acc-rate">{t('settings.accounting.tax_rate_label')}</Label>
            <Select
              value={draft.tax_rate != null ? String(draft.tax_rate) : ''}
              onValueChange={(v) => patch('tax_rate', Number(v))}
            >
              <SelectTrigger id="acc-rate">
                <SelectValue placeholder={t('settings.accounting.tax_rate_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {tax.rates.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {/* Document delivery */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>{t('settings.accounting.delivery_label')}</Label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: 'portal', label: t('settings.accounting.delivery_portal') },
                { value: 'email', label: t('settings.accounting.delivery_email') },
                { value: 'both', label: t('settings.accounting.delivery_both') },
              ] as const
            ).map((opt) => {
              const active = draft.document_delivery === opt.value
              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => patch('document_delivery', opt.value)}
                  className={`h-10 rounded-md border-[1.5px] px-4 text-sm font-semibold transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Portal select */}
        {draft.document_delivery === 'portal' || draft.document_delivery === 'both' ? (
          <>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="acc-portal">{t('settings.accounting.portal_label')}</Label>
              <Select value={draft.portal ?? ''} onValueChange={(v) => patch('portal', v)}>
                <SelectTrigger id="acc-portal">
                  <SelectValue placeholder={t('settings.accounting.portal_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {PORTAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Если портал «other» — текст-поле с названием. */}
              {draft.portal === 'other' ? (
                <Input
                  value={draft.portal_other_name ?? ''}
                  onChange={(e) => patch('portal_other_name', e.target.value)}
                  placeholder={t('settings.accounting.portal_other_placeholder')}
                  className="mt-2"
                />
              ) : null}
              {/* Hints: подключить интеграцию / скоро добавим / KSeF e-Faktura. */}
              {portalIntegrationProvider && portalIntegrationProvider !== 'ksef' ? (
                portalIsConnected ? (
                  <p className="text-brand-sage-deep text-xs font-medium">
                    {t('settings.accounting.portal_connected')}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {t('settings.accounting.portal_not_connected')}{' '}
                    <Link
                      to={`/salon/${salonId}/integrations`}
                      className="text-primary font-semibold hover:underline"
                    >
                      {t('settings.accounting.portal_connect_cta')}
                    </Link>
                  </p>
                )
              ) : null}
              {draft.portal === 'ksef' ? (
                <p className="text-muted-foreground text-xs">
                  {t('settings.accounting.portal_ksef_hint')}
                </p>
              ) : null}
              {draft.portal === 'other' ? (
                <p className="text-muted-foreground text-xs">
                  {t('settings.accounting.portal_other_hint')}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {/* Image #135/#136: email бухгалтера НЕ запрашиваем тут — он берётся
            из аккаунта в «Пользователях». Только hint + CTA на создание акка.
            При канале email/portal+email дополнительно спрашиваем частоту
            отправки. */}
        {showEmailHint ? (
          <div className="flex flex-col gap-3 sm:col-span-2">
            <div className="bg-brand-teal-soft/40 border-brand-teal-soft rounded-md border p-3 text-xs">
              <p className="text-brand-teal-deep font-semibold">
                {t('settings.accounting.team_hint_title')}
              </p>
              <p className="text-brand-teal-deep/90 mt-1">
                {t('settings.accounting.team_hint_body')}
              </p>
              <Link
                to={`/salon/${salonId}/settings?tab=team`}
                className="text-brand-teal-deep mt-2 inline-block font-semibold hover:underline"
              >
                {t('settings.accounting.team_hint_cta')}
              </Link>
            </div>

            <EmailFrequencyPicker
              value={draft.email_frequency}
              onChange={(v) => patch('email_frequency', v)}
            />
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <Button size="lg" onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>
    </section>
  )
}

/**
 * EmailFrequencyPicker — image #135/#136. Спрашиваем как часто слать
 * расходы бухгалтеру по email. Варианты:
 *   • Сразу после добавления расхода (kind='immediate')
 *   • 1 раз в день — время (kind='daily', time)
 *   • 1 раз в неделю — день недели + время (kind='weekly')
 *   • 1 раз в месяц — число + время (kind='monthly')
 *   • В начале след. месяца — число + время (kind='next_month_start')
 *
 * Для month/next_month_start если число > длины месяца — отправка будет
 * в последний день месяца (валидируется в edge-функции при отправке,
 * здесь только подсказка).
 */
type EmailFrequencyPickerProps = {
  value: AccountingSettings['email_frequency']
  onChange: (next: AccountingSettings['email_frequency']) => void
}

function EmailFrequencyPicker({ value, onChange }: EmailFrequencyPickerProps) {
  const { t } = useTranslation()
  const kind = value?.kind ?? 'immediate'

  function update(patch: Partial<NonNullable<AccountingSettings['email_frequency']>>) {
    onChange({
      ...(value as object),
      ...(patch as object),
    } as AccountingSettings['email_frequency'])
  }

  function setKind(nextKind: NonNullable<AccountingSettings['email_frequency']>['kind']) {
    if (nextKind === 'immediate') onChange({ kind: 'immediate' })
    else if (nextKind === 'daily') onChange({ kind: 'daily', time: '09:00' })
    else if (nextKind === 'weekly') onChange({ kind: 'weekly', time: '09:00', day_of_week: 1 })
    else if (nextKind === 'monthly') onChange({ kind: 'monthly', time: '09:00', day_of_month: 1 })
    else if (nextKind === 'next_month_start')
      onChange({ kind: 'next_month_start', time: '09:00', day_of_month: 5 })
  }

  const FREQ_OPTIONS = [
    { value: 'immediate' as const, label: t('settings.accounting.freq.immediate') },
    { value: 'daily' as const, label: t('settings.accounting.freq.daily') },
    { value: 'weekly' as const, label: t('settings.accounting.freq.weekly') },
    { value: 'monthly' as const, label: t('settings.accounting.freq.monthly') },
    { value: 'next_month_start' as const, label: t('settings.accounting.freq.next_month_start') },
  ]

  const WEEKDAYS = [
    { value: 1, label: t('settings.accounting.freq.weekday_1') },
    { value: 2, label: t('settings.accounting.freq.weekday_2') },
    { value: 3, label: t('settings.accounting.freq.weekday_3') },
    { value: 4, label: t('settings.accounting.freq.weekday_4') },
    { value: 5, label: t('settings.accounting.freq.weekday_5') },
    { value: 6, label: t('settings.accounting.freq.weekday_6') },
    { value: 7, label: t('settings.accounting.freq.weekday_7') },
  ]

  return (
    <div className="flex flex-col gap-2.5">
      <Label>{t('settings.accounting.freq.label')}</Label>
      <div className="flex flex-wrap gap-2">
        {FREQ_OPTIONS.map((opt) => {
          const active = kind === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKind(opt.value)}
              className={`h-10 rounded-md border-[1.5px] px-3 text-sm font-semibold transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card hover:bg-muted/40'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Дополнительные параметры в зависимости от выбора. */}
      {value && value.kind !== 'immediate' ? (
        <div className="border-border bg-muted/10 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t('settings.accounting.freq.time_label')}</Label>
            <Input
              type="time"
              value={'time' in value ? value.time : '09:00'}
              onChange={(e) => update({ time: e.target.value })}
            />
          </div>

          {value.kind === 'weekly' ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t('settings.accounting.freq.day_of_week_label')}</Label>
              <Select
                value={String(value.day_of_week)}
                onValueChange={(v) => update({ day_of_week: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {value.kind === 'monthly' || value.kind === 'next_month_start' ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t('settings.accounting.freq.day_of_month_label')}</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={value.day_of_month}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(31, Number(e.target.value) || 1))
                  update({ day_of_month: n })
                }}
              />
              <p className="text-muted-foreground text-[10.5px]">
                {t('settings.accounting.freq.day_of_month_hint')}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
