import { Download, Mail, Plug, Upload, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDeleteSalon, useUpdateSalon } from '@/hooks/useSalonMutations'
import { useSalon } from '@/hooks/useSalons'
import { useSubscription } from '@/hooks/useSubscription'
import { useToggleBenchmarksOptIn } from '@/hooks/useBenchmarks'
import { useUpdateOpeningCashBalance } from '@/hooks/useExpenseExtras'
import { useSendWeeklyDigest, useToggleWeeklyDigest } from '@/hooks/useWeeklyDigest'
import { InstallAppButton } from '@/components/pwa/InstallAppButton'
import { PushNotificationsCard } from './PushNotificationsCard'
import { BillingButtons } from '@/routes/billing/BillingButtons'
import {
  COUNTRY_OPTIONS,
  SALON_TYPES,
  type CountryCode,
  type SalonTypeId,
} from '@/routes/onboarding/onboarding-defaults'

/**
 * /{salonId}/settings — профиль салона (TASK-18).
 * Поля: имя, страна (autoset валюты+timezone), тип. Логотип в Storage —
 * упрощённо (URL-инпут) в стадии 1, полноценный uploader — в TASK-23/PWA.
 *
 * Опасные действия:
 * - «Удалить салон» — soft delete, требует ввести имя салона как подтверждение
 * - «Экспорт данных» — placeholder, реальный CSV/PDF в TASK-26
 */
export function SettingsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const navigate = useNavigate()
  const { data: salon } = useSalon(salonId)
  const update = useUpdateSalon()
  const remove = useDeleteSalon()
  const { data: subscription } = useSubscription(salonId)
  const sendDigest = useSendWeeklyDigest(salonId)
  const toggleDigest = useToggleWeeklyDigest(salonId)
  const toggleBenchmarks = useToggleBenchmarksOptIn(salonId)
  const updateOpeningCash = useUpdateOpeningCashBalance(salonId)
  const [openingCashDraft, setOpeningCashDraft] = useState('')

  const [name, setName] = useState('')
  const [country, setCountry] = useState<CountryCode>('PL')
  const [salonType, setSalonType] = useState<SalonTypeId>('hair')
  const [logoUrl, setLogoUrl] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [exportPending, setExportPending] = useState(false)

  async function handleExport() {
    setExportPending(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('not_authenticated')
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-export`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
      const json = (await res.json()) as {
        ok?: boolean
        download_url?: string
        cached?: boolean
        error?: string
        message?: string
      }
      if (!res.ok || !json.ok || !json.download_url) {
        throw new Error(json.message || json.error || `HTTP ${res.status}`)
      }
      // Авто-открытие ссылки в новой вкладке + тоаст. Письмо ушло в любом случае.
      window.open(json.download_url, '_blank', 'noopener')
      toast.success(
        json.cached ? t('settings.export.toast_cached') : t('settings.export.toast_ready'),
      )
    } catch (err) {
      toast.error(t('settings.export.toast_failed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setExportPending(false)
    }
  }

  useEffect(() => {
    if (!salon) return
    setName(salon.name)
    setCountry(salon.country_code as CountryCode)
    setSalonType(salon.salon_type as SalonTypeId)
    setLogoUrl(salon.logo_url ?? '')
    setOpeningCashDraft(
      salon.opening_cash_balance_cents > 0 ? String(salon.opening_cash_balance_cents / 100) : '',
    )
  }, [salon])

  if (!salon || !salonId) return null

  const dirty =
    name !== salon.name ||
    country !== salon.country_code ||
    salonType !== salon.salon_type ||
    logoUrl !== (salon.logo_url ?? '')

  function save() {
    if (!salon) return
    if (name.trim().length < 2) {
      toast.error(t('settings.errors.name_too_short'))
      return
    }
    const c = COUNTRY_OPTIONS.find((x) => x.code === country)!
    update.mutate(
      {
        id: salon.id,
        name: name.trim(),
        country_code: country,
        currency: c.currency,
        timezone: c.timezone,
        salon_type: salonType,
        logo_url: logoUrl.trim() || null,
      },
      {
        onSuccess: () => toast.success(t('settings.toast_saved')),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function handleDelete() {
    if (!salon) return
    if (confirmName.trim() !== salon.name) {
      toast.error(t('settings.delete.confirm_mismatch'))
      return
    }
    remove.mutate(salon.id, {
      onSuccess: () => {
        toast.success(t('settings.delete.toast_deleted'))
        setDeleteOpen(false)
        navigate('/', { replace: true })
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('settings.subtitle')}</p>
      </header>

      {/* Профиль */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <h2 className="text-brand-navy mb-4 text-base font-bold tracking-tight">
          {t('settings.profile.title')}
        </h2>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="set-name">{t('settings.profile.name_label')}</Label>
            <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-country">{t('settings.profile.country_label')}</Label>
            <Select value={country} onValueChange={(v) => setCountry(v as CountryCode)}>
              <SelectTrigger id="set-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name} · {c.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{t('settings.profile.country_hint')}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-type">{t('settings.profile.type_label')}</Label>
            <Select value={salonType} onValueChange={(v) => setSalonType(v as SalonTypeId)}>
              <SelectTrigger id="set-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALON_TYPES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="set-logo">{t('settings.profile.logo_label')}</Label>
            <Input
              id="set-logo"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
            />
            <p className="text-muted-foreground text-xs">{t('settings.profile.logo_hint')}</p>
          </div>

          <div className="sm:col-span-2">
            <Button
              size="lg"
              onClick={save}
              disabled={!dirty || update.isPending}
              data-testid="settings-save"
            >
              {update.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>
      </section>

      {/* Установка приложения (PWA) */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.install.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('settings.install.subtitle')}</p>
          </div>
          <InstallAppButton />
        </div>
      </section>

      {/* Push-уведомления */}
      <div className="mb-6">
        <PushNotificationsCard />
      </div>

      {/* Подписка */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.billing.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {subscription
                ? t(`settings.billing.status_${subscription.status}`, {
                    defaultValue: subscription.status,
                  })
                : t('settings.billing.no_subscription')}
            </p>
          </div>
          <BillingButtons salonId={salonId} subscription={subscription ?? null} />
        </div>
      </section>

      {/* Еженедельный дайджест */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.digest.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('settings.digest.subtitle')}</p>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={salon.weekly_digest_enabled}
                onChange={(e) =>
                  toggleDigest.mutate(e.target.checked, {
                    onSuccess: () =>
                      toast.success(
                        e.target.checked
                          ? t('settings.digest.toast_enabled')
                          : t('settings.digest.toast_disabled'),
                      ),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }
                className="size-4 cursor-pointer"
              />
              <span className="text-foreground">
                {salon.weekly_digest_enabled
                  ? t('settings.digest.enabled')
                  : t('settings.digest.disabled')}
              </span>
            </label>
          </div>
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              sendDigest.mutate(undefined, {
                onSuccess: (data) =>
                  toast.success(t('settings.digest.toast_sent', { email: data?.sent_to ?? '' })),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }}
            disabled={sendDigest.isPending || !salon.weekly_digest_enabled}
            data-testid="settings-digest-send"
          >
            <Mail className="size-4" strokeWidth={1.7} />
            {sendDigest.isPending ? t('common.loading') : t('settings.digest.button')}
          </Button>
        </div>
      </section>

      {/* Касса — opening balance */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.cash.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('settings.cash.subtitle')}</p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={openingCashDraft}
            onChange={(e) => setOpeningCashDraft(e.target.value)}
            placeholder="0"
            className="h-11 w-40"
            data-testid="settings-opening-cash"
          />
          <span className="text-muted-foreground text-sm">{salon.currency}</span>
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              const trimmed = openingCashDraft.trim().replace(',', '.')
              const cents = trimmed === '' ? 0 : Math.round(Number(trimmed) * 100)
              if (Number.isNaN(cents) || cents < 0) {
                toast.error(t('settings.cash.invalid'))
                return
              }
              updateOpeningCash.mutate(cents, {
                onSuccess: () => toast.success(t('settings.cash.toast_saved')),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }}
            disabled={updateOpeningCash.isPending}
          >
            {t('common.save')}
          </Button>
        </div>
      </section>

      {/* Сравнение с рынком */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.benchmarks.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('settings.benchmarks.subtitle')}</p>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={salon.benchmarks_opt_in}
            onChange={(e) =>
              toggleBenchmarks.mutate(e.target.checked, {
                onSuccess: () =>
                  toast.success(
                    e.target.checked
                      ? t('settings.benchmarks.toast_enabled')
                      : t('settings.benchmarks.toast_disabled'),
                  ),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }
            className="size-4 cursor-pointer"
          />
          <span className="text-foreground">
            {salon.benchmarks_opt_in
              ? t('settings.benchmarks.enabled')
              : t('settings.benchmarks.disabled')}
          </span>
        </label>
      </section>

      {/* Команда */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.team.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('settings.team.subtitle')}</p>
          </div>
          <Button variant="outline" size="md" onClick={() => navigate(`/${salonId}/settings/team`)}>
            <Users className="size-4" strokeWidth={1.7} />
            {t('settings.team.button')}
          </Button>
        </div>
      </section>

      {/* Интеграции */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.integrations.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('settings.integrations.subtitle')}
            </p>
          </div>
          <Button
            variant="outline"
            size="md"
            onClick={() => navigate(`/${salonId}/settings/integrations`)}
            data-testid="settings-integrations"
          >
            <Plug className="size-4" strokeWidth={1.7} />
            {t('settings.integrations.button')}
          </Button>
        </div>
      </section>

      {/* Импорт данных */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.import.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('settings.import.subtitle')}</p>
          </div>
          <Button
            variant="outline"
            size="md"
            onClick={() => navigate(`/${salonId}/settings/import`)}
            data-testid="settings-import"
          >
            <Upload className="size-4" strokeWidth={1.7} />
            {t('settings.import.button')}
          </Button>
        </div>
      </section>

      {/* Экспорт данных */}
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.export.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('settings.export.subtitle')}</p>
          </div>
          <Button
            variant="outline"
            size="md"
            onClick={handleExport}
            disabled={exportPending}
            data-testid="settings-export"
          >
            <Download className="size-4" strokeWidth={1.7} />
            {exportPending ? t('common.loading') : t('settings.export.button')}
          </Button>
        </div>
      </section>

      {/* Опасная зона */}
      <section className="border-destructive/30 bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
        <h2 className="text-destructive mb-1 text-base font-bold tracking-tight">
          {t('settings.delete.title')}
        </h2>
        <p className="text-muted-foreground mb-4 text-sm">{t('settings.delete.subtitle')}</p>
        <Button
          variant="destructive"
          size="md"
          onClick={() => {
            setConfirmName('')
            setDeleteOpen(true)
          }}
          data-testid="settings-delete"
        >
          {t('settings.delete.button')}
        </Button>
      </section>

      {/* Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.delete.modal_title')}</DialogTitle>
            <DialogDescription>{t('settings.delete.modal_subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-5 py-4">
            <p className="text-foreground text-sm">
              {t('settings.delete.confirm_prompt', { name: salon.name })}
            </p>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={salon.name}
              autoFocus
              data-testid="settings-delete-confirm"
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              size="lg"
              onClick={handleDelete}
              disabled={remove.isPending || confirmName.trim() !== salon.name}
              data-testid="settings-delete-submit"
            >
              {remove.isPending ? t('common.loading') : t('settings.delete.confirm_button')}
            </Button>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="text-muted-foreground hover:text-foreground text-center text-sm font-semibold"
            >
              {t('common.cancel')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
