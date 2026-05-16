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
import { LEGAL_FORMS, getLegalForm, getTaxForm } from '@/lib/accounting/forms'

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

const PORTAL_OPTIONS: Array<{ value: string; label: string; integration_provider?: string }> = [
  { value: 'wfirma', label: 'wFirma', integration_provider: 'wfirma' },
  { value: 'fakturownia', label: 'Fakturownia', integration_provider: 'fakturownia' },
  { value: 'infakt', label: 'inFakt', integration_provider: 'infakt' },
  { value: 'ksef', label: 'KSeF (Krajowy System e-Faktur)', integration_provider: 'ksef' },
  { value: 'other', label: 'Другой портал (укажу название)' },
]

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
      setDraft((prev) => ({
        ...prev,
        nip,
        company_name: prev.company_name || res.name,
        address: prev.address || res.address,
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

        {/* Accountant email + hint */}
        {showEmailHint ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="acc-email">{t('settings.accounting.accountant_email_label')}</Label>
            <Input
              id="acc-email"
              type="email"
              value={draft.accountant_email ?? ''}
              onChange={(e) => patch('accountant_email', e.target.value)}
              placeholder="ksiegowy@firma.pl"
            />
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
