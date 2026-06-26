import {
  Calendar,
  ChevronRight,
  Clock,
  Download,
  History,
  Scissors,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { IntegrationsContent } from '@/routes/integrations/IntegrationsPage'
import { TeamPage } from '@/routes/team/TeamPage'

import { Button } from '@/components/ui/button'
import { ImageCropper } from '@/components/ui/ImageCropper'
import { formatError } from '@/lib/format-error'
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
import { uploadSalonLogo, useDeleteSalon, useUpdateSalon } from '@/hooks/useSalonMutations'
import { usePermissions } from '@/hooks/usePermissions'
import { useSalon } from '@/hooks/useSalons'
import { useSubscription } from '@/hooks/useSubscription'
import { useToggleBenchmarksOptIn } from '@/hooks/useBenchmarks'
import { Link } from 'react-router-dom'

import { HelpFAQ } from '@/routes/help/HelpFAQ'

import { GooglePlaceSearchInput } from '@/components/settings/GooglePlaceSearchInput'
import { useSyncCompetitors } from '@/hooks/useCompetitors'
import { TelegramLinkCard } from '@/components/settings/TelegramLinkCard'
import { AccountingSettingsCard } from '@/routes/settings/AccountingSettingsCard'
import { CashDisciplineCard } from '@/routes/settings/CashDisciplineCard'
import { PageTabsNav } from '@/components/ui/PageTabsNav'
import { ApiKeysCard } from './ApiKeysCard'
import { SalonHoursCard } from './SalonHoursCard'
import { SalonHolidaysCard } from './SalonHolidaysCard'
// SegmentationCard перенесён в /staff (Справочник мастеров).
import { MFACard } from './MFACard'
import { NotificationsTabContent } from './NotificationsTabContent'
// ReferralCard убран из Settings — раньше жил на отдельной вкладке /team.
import { CollapsibleSection } from '@/routes/dashboard/CollapsibleSection'
import { UserProfileCard } from './UserProfileCard'
import { SETTINGS_TABS, SettingsTabsNav, type SettingsTab } from './SettingsTabsNav'
import { BillingButtons } from '@/routes/billing/BillingButtons'
import { BillingSubscriptionStatus } from '@/routes/billing/BillingSubscriptionStatus'
import {
  COUNTRY_OPTIONS,
  SALON_TYPES,
  type CountryCode,
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
/**
 * Простая card-ссылка для секции «Справочники». Ведёт на полноценную
 * CRUD-страницу (мастера/услуги/клиенты/...) которые до TASK-53 жили
 * прямо в sidebar.
 */
function CatalogCard({
  to,
  icon: Icon,
  title,
  subtitle,
}: {
  to: string
  icon: typeof Users
  title: string
  subtitle: string
}) {
  return (
    <Link
      to={to}
      className="border-border bg-card hover:border-secondary/60 hover:bg-muted/30 flex items-center gap-3 rounded-lg border p-4 transition-colors"
    >
      <div className="bg-brand-teal-soft text-brand-teal-deep grid size-10 shrink-0 place-items-center rounded-md">
        <Icon className="size-5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{subtitle}</p>
      </div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" strokeWidth={1.7} />
    </Link>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const navigate = useNavigate()
  const { data: salon } = useSalon(salonId)
  const update = useUpdateSalon()
  const remove = useDeleteSalon()
  const syncCompetitors = useSyncCompetitors(salonId)
  const { data: subscription } = useSubscription(salonId)
  const toggleBenchmarks = useToggleBenchmarksOptIn(salonId)

  const [name, setName] = useState('')
  const [country, setCountry] = useState<CountryCode>('PL')
  // salonType хранит строку — либо id из SALON_TYPES, либо кастомное имя,
  // которое пользователь ввёл сам (image #80). UI отображает либо выпадающий
  // список, либо текстовое поле под опцией «Другое...».
  const [salonType, setSalonType] = useState<string>('hair')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoCropFile, setLogoCropFile] = useState<File | null>(null)
  // Адрес и публичные ссылки. Нужны для:
  //   - google_place_url → редирект 5★ отзывов в FlySMS-flow (review/<token>)
  //   - google_place_id  → импорт отзывов с Google + rating мониторинг
  //   - booksy_url       → импорт отзывов с Booksy
  //   - address/lat/lng  → автоподбор конкурентов через Nearby Search
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [lat, setLat] = useState<string>('')
  const [lng, setLng] = useState<string>('')
  const [googlePlaceUrl, setGooglePlaceUrl] = useState('')
  const [googlePlaceId, setGooglePlaceId] = useState('')
  const [booksyUrl, setBooksyUrl] = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  const [facebookUrl, setFacebookUrl] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  // Если URL = /settings/integrations — это вкладка интеграций. Иначе
  // активная вкладка читается из ?tab=.
  const isIntegrationsUrl = location.pathname.endsWith('/settings/integrations')
  const tabParam = searchParams.get('tab') as SettingsTab | null
  // T36 — фильтр табов Settings по permissions matrix. profile/team/schedule/
  // integrations/help мапятся в матрицу; catalogs/notifications/billing/
  // security/api дополнительных permission-ключей не имеют — показываем всем
  // у кого есть хоть какой-то settings.* view.
  const { can, role } = usePermissions(salonId)
  const tabPermKey: Partial<Record<SettingsTab, string>> = {
    profile: 'profile_user',
    team: 'users',
    schedule: 'schedule',
    integrations: 'integrations',
    help: 'help',
  }
  // Bug (баг-трекер): мастер (staff) видел owner-only вкладки. Справочник,
  // Биллинг и API — целиком для собственника, мастеру там делать нечего →
  // прячем для staff/external. Безопасность (2FA) и Уведомления (о своих
  // визитах) мастеру нужны частично — их оставляем, owner-only секции внутри
  // гейтятся отдельно.
  const OWNER_ONLY_TABS: SettingsTab[] = ['catalogs', 'billing', 'api']
  const restrictOwnerTabs = role === 'staff' || role === 'external'
  const visibleSettingsTabs = SETTINGS_TABS.filter((t) => {
    if (restrictOwnerTabs && OWNER_ONLY_TABS.includes(t)) return false
    const key = tabPermKey[t]
    if (!key) return true // unmanaged tabs (notifications/security) — открыты
    return can('settings', key)
  })
  const requestedActiveTab: SettingsTab = isIntegrationsUrl
    ? 'integrations'
    : tabParam && (SETTINGS_TABS as readonly string[]).includes(tabParam)
      ? tabParam
      : 'profile'
  const activeTab: SettingsTab = visibleSettingsTabs.includes(requestedActiveTab)
    ? requestedActiveTab
    : (visibleSettingsTabs[0] ?? 'profile')
  function setActiveTab(t: SettingsTab) {
    // Спец-кейс: вкладка интеграций живёт по отдельному URL.
    if (t === 'integrations') {
      navigate(`/${salonId}/settings/integrations`)
      return
    }
    if (isIntegrationsUrl) {
      navigate(`/${salonId}/settings?tab=${t}`)
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('tab', t)
    setSearchParams(next, { replace: true })
  }
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
        description: formatError(err),
      })
    } finally {
      setExportPending(false)
    }
  }

  useEffect(() => {
    if (!salon) return
    setName(salon.name)
    setCountry(salon.country_code as CountryCode)
    setSalonType(salon.salon_type ?? 'hair')
    setLogoUrl(salon.logo_url ?? '')
    setAddress(salon.address ?? '')
    setCity(salon.city ?? '')
    setLat(salon.lat != null ? String(salon.lat) : '')
    setLng(salon.lng != null ? String(salon.lng) : '')
    setGooglePlaceUrl(salon.google_place_url ?? '')
    setGooglePlaceId(salon.google_place_id ?? '')
    setBooksyUrl(salon.booksy_url ?? '')
    setInstagramUrl(salon.instagram_url ?? '')
    setFacebookUrl(salon.facebook_url ?? '')
  }, [salon])

  if (!salon || !salonId) return null

  const dirty =
    name !== salon.name ||
    country !== salon.country_code ||
    salonType !== salon.salon_type ||
    logoUrl !== (salon.logo_url ?? '') ||
    address !== (salon.address ?? '') ||
    city !== (salon.city ?? '') ||
    lat !== (salon.lat != null ? String(salon.lat) : '') ||
    lng !== (salon.lng != null ? String(salon.lng) : '') ||
    googlePlaceUrl !== (salon.google_place_url ?? '') ||
    googlePlaceId !== (salon.google_place_id ?? '') ||
    booksyUrl !== (salon.booksy_url ?? '') ||
    instagramUrl !== (salon.instagram_url ?? '') ||
    facebookUrl !== (salon.facebook_url ?? '')

  function save() {
    if (!salon) return
    if (name.trim().length < 2) {
      toast.error(t('settings.errors.name_too_short'))
      return
    }
    const c = COUNTRY_OPTIONS.find((x) => x.code === country)!
    // Парсим координаты: пусто → null; иначе число (NaN = валидационная ошибка).
    const latN = lat.trim() ? Number(lat.replace(',', '.')) : null
    const lngN = lng.trim() ? Number(lng.replace(',', '.')) : null
    if (latN != null && !Number.isFinite(latN)) {
      toast.error(t('settings.profile.lat_invalid'))
      return
    }
    if (lngN != null && !Number.isFinite(lngN)) {
      toast.error(t('settings.profile.lng_invalid'))
      return
    }
    update.mutate(
      {
        id: salon.id,
        name: name.trim(),
        country_code: country,
        currency: c.currency,
        timezone: c.timezone,
        salon_type: salonType,
        logo_url: logoUrl.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        lat: latN,
        lng: lngN,
        google_place_url: googlePlaceUrl.trim() || null,
        google_place_id: googlePlaceId.trim() || null,
        booksy_url: booksyUrl.trim() || null,
        instagram_url: instagramUrl.trim() || null,
        facebook_url: facebookUrl.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t('settings.toast_saved'))
          // Если поменялся place_id / booksy_url — дёрнем competitor-sync чтобы
          // own_salon_metrics обновились без ожидания cron'а. Иначе юзер видит
          // старые числа в Reports → Конкуренты → Рейтинг.
          const placeIdChanged = googlePlaceId.trim() !== (salon?.google_place_id ?? '')
          const booksyChanged = booksyUrl.trim() !== (salon?.booksy_url ?? '')
          if (placeIdChanged || booksyChanged) {
            syncCompetitors.mutate(undefined, {
              onError: (e) => console.warn('competitor-sync after place update failed:', e),
            })
          }
        },
        onError: (err) => toast.error(formatError(err)),
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
      onError: (err) => {
        const raw = formatError(err)
        // RPC soft_delete_salon кидает known errcode'ы через RAISE EXCEPTION —
        // в PostgrestError они приезжают как message. Маппим в i18n,
        // остальное — как есть.
        const known = ['not_owner', 'not_authenticated', 'salon_not_found'] as const
        const matched = known.find((k) => raw.includes(k))
        toast.error(matched ? t(`settings.delete.errors.${matched}`) : raw)
      },
    })
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('settings.subtitle')}</p>
      </header>

      <SettingsTabsNav
        active={activeTab}
        onChange={setActiveTab}
        visibleTabs={visibleSettingsTabs}
      />

      {activeTab === 'profile' && (
        <>
          {/* T27 — блок «Профиль пользователя» (новый). Свёрнут по умолчанию
              как и остальные блоки. Юзер может изменить имя, телефон, аватар
              и пароль. Email — read-only. */}
          <CollapsibleSection
            id="settings.user_profile"
            title={t('settings.user_profile.title', { defaultValue: 'Профиль пользователя' })}
            defaultOpen={false}
            className="mb-6"
          >
            <div className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
              <UserProfileCard />
            </div>
          </CollapsibleSection>

          {/* Bug (баг-трекер): мастеру (staff) в «Профиле» нужен только блок
              «Профиль пользователя». Owner-секции (профиль салона, адрес,
              бухгалтерия, касса, Telegram, сравнение, удаление салона) —
              скрываем для staff/external. */}
          {!restrictOwnerTabs && (
            <>
              {/* T27 — блок «Профиль салона». Свёрнут по умолчанию. */}
              <CollapsibleSection
                id="settings.salon_profile"
                title={t('settings.profile.title')}
                defaultOpen={false}
                className="mb-6"
              >
                <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
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
                              {t(`onboarding.country.${c.code}`, { defaultValue: c.name })} ·{' '}
                              {c.currency}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-muted-foreground text-xs">
                        {t('settings.profile.country_hint')}
                      </p>
                    </div>

                    {/* Тип салона (image #80). Если значение совпадает с одним из
                  предустановленных id — селект показывает его. Иначе считаем
                  это кастомным значением — выбираем "__custom__" и рядом
                  открываем Input для ручного редактирования. */}
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="set-type">{t('settings.profile.type_label')}</Label>
                      {(() => {
                        const isPreset = SALON_TYPES.some((s) => s.id === salonType)
                        const selectValue = isPreset ? salonType : '__custom__'
                        return (
                          <>
                            <Select
                              value={selectValue}
                              onValueChange={(v) => {
                                if (v === '__custom__') {
                                  // Переключение в режим custom — оставляем текущее
                                  // значение если оно уже custom, иначе пусто чтобы
                                  // юзер увидел свободный input.
                                  setSalonType(isPreset ? '' : salonType)
                                } else {
                                  setSalonType(v)
                                }
                              }}
                            >
                              <SelectTrigger id="set-type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SALON_TYPES.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {t(`onboarding.salon_type.${s.id}`, { defaultValue: s.name })}
                                  </SelectItem>
                                ))}
                                <SelectItem value="__custom__">
                                  {t('settings.profile.type_custom')}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {!isPreset ? (
                              <Input
                                autoFocus
                                value={salonType}
                                onChange={(e) => setSalonType(e.target.value)}
                                placeholder={t('settings.profile.type_custom_placeholder')}
                                maxLength={60}
                              />
                            ) : null}
                          </>
                        )
                      })()}
                    </div>

                    <div className="flex flex-col gap-2 sm:col-span-2">
                      <Label htmlFor="set-logo">{t('settings.profile.logo_label')}</Label>
                      <div className="flex items-center gap-4">
                        {logoUrl ? (
                          <img
                            src={logoUrl}
                            alt="logo"
                            className="border-border bg-muted size-16 rounded-md border object-contain"
                          />
                        ) : (
                          <div className="border-border bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-md border text-xs">
                            —
                          </div>
                        )}
                        <div className="flex flex-1 flex-col gap-1.5">
                          <input
                            id="set-logo"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="text-muted-foreground file:border-border file:bg-muted file:text-foreground hover:file:bg-muted/80 text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
                            disabled={logoUploading}
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (!file || !salon) return
                              if (file.size > 5 * 1024 * 1024) {
                                toast.error(t('settings.profile.logo_too_large'))
                                e.target.value = ''
                                return
                              }
                              setLogoCropFile(file)
                              e.target.value = ''
                            }}
                          />
                          {logoUrl ? (
                            <button
                              type="button"
                              onClick={() => setLogoUrl('')}
                              className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-2 hover:underline"
                            >
                              {t('settings.profile.logo_remove')}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {t('settings.profile.logo_hint')}
                      </p>
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
              </CollapsibleSection>

              {/* График работы и праздники переехали в Settings → «График работы»
              (image #71) — две подвкладки: SalonHoursCard и SalonHolidaysCard. */}

              {/* Адрес и публичные ссылки. Заполнение нужно для:
                  – /review/:token (5★ → google_place_url редирект)
                  – reviews-sync (импорт отзывов с Booksy + Google Places)
                  – competitor-discover (Nearby Search вокруг lat/lng).

              Поиск Google Places стоит первым — клик по найденному месту
              авто-заполняет address/city/lat/lng/google_place_url/google_place_id
              в один шаг. Остальные инпуты редактируемые на случай если
              юзер хочет уточнить (например адрес другим языком). */}
              <CollapsibleSection
                id="settings.salon_address"
                title={t('settings.profile.public_title')}
                defaultOpen={false}
                className="mb-6"
              >
                <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
                  <h2 className="text-brand-navy mb-1 text-base font-bold tracking-tight">
                    {t('settings.profile.public_title')}
                  </h2>
                  <p className="text-muted-foreground mb-4 text-sm">
                    {t('settings.profile.public_subtitle')}
                  </p>

                  <div className="mb-4">
                    <Label className="mb-1.5 block">
                      {t('settings.profile.place_search.label')}
                    </Label>
                    <GooglePlaceSearchInput
                      initialName={salon.name}
                      initialPlaceId={googlePlaceId || null}
                      onPick={(p) => {
                        setGooglePlaceId(p.google_place_id)
                        setGooglePlaceUrl(p.google_maps_uri ?? '')
                        if (p.address) setAddress(p.address)
                        if (p.lat != null) setLat(String(p.lat))
                        if (p.lng != null) setLng(String(p.lng))
                        // Город попытаемся вытащить из адреса (последний компонент
                        // обычно страна, предпоследний — город. Это эвристика).
                        if (p.address) {
                          const parts = p.address.split(',').map((s) => s.trim())
                          if (parts.length >= 2) setCity(parts[parts.length - 2] ?? '')
                        }
                      }}
                      onClear={() => {
                        setGooglePlaceId('')
                        setGooglePlaceUrl('')
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="set-address">{t('settings.profile.address_label')}</Label>
                      <Input
                        id="set-address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={t('settings.profile.address_placeholder')}
                      />
                      <p className="text-muted-foreground text-xs">
                        {t('settings.profile.address_hint')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="set-city">{t('settings.profile.city_label')}</Label>
                      <Input
                        id="set-city"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder={t('settings.profile.city_placeholder')}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t('settings.profile.coords_label')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={lat}
                          onChange={(e) => setLat(e.target.value)}
                          placeholder="52.2297"
                          className="num"
                        />
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={lng}
                          onChange={(e) => setLng(e.target.value)}
                          placeholder="21.0122"
                          className="num"
                        />
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {t('settings.profile.coords_hint')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="set-booksy-url">Booksy URL</Label>
                      <Input
                        id="set-booksy-url"
                        value={booksyUrl}
                        onChange={(e) => setBooksyUrl(e.target.value)}
                        placeholder="https://booksy.com/..."
                      />
                      <p className="text-muted-foreground text-xs">
                        {t('settings.profile.booksy_url_hint')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="set-instagram-url">Instagram</Label>
                      <Input
                        id="set-instagram-url"
                        value={instagramUrl}
                        onChange={(e) => setInstagramUrl(e.target.value)}
                        placeholder="https://instagram.com/yoursalon"
                      />
                      <p className="text-muted-foreground text-xs">
                        {t('settings.profile.instagram_url_hint')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="set-facebook-url">Facebook</Label>
                      <Input
                        id="set-facebook-url"
                        value={facebookUrl}
                        onChange={(e) => setFacebookUrl(e.target.value)}
                        placeholder="https://facebook.com/yoursalon"
                      />
                      <p className="text-muted-foreground text-xs">
                        {t('settings.profile.facebook_url_hint')}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <Button
                        size="lg"
                        onClick={save}
                        disabled={!dirty || update.isPending}
                        data-testid="settings-save-public"
                      >
                        {update.isPending ? t('common.loading') : t('common.save')}
                      </Button>
                    </div>
                  </div>
                </section>
              </CollapsibleSection>

              {/* Бухгалтерия (image #122): юр. данные компании, налоговая
              схема, доставка документов бухгалтеру. */}
              <CollapsibleSection
                id="settings.accounting"
                title={t('settings.accounting.title', { defaultValue: 'Бухгалтерия' })}
                defaultOpen={false}
                className="mb-6"
              >
                {salonId ? <AccountingSettingsCard salonId={salonId} /> : null}
              </CollapsibleSection>

              {/* Касса (опц.) — включатель кассового дня. */}
              <CollapsibleSection
                id="settings.cash_discipline"
                title={t('settings.cash_discipline.title', { defaultValue: 'Кассовая дисциплина' })}
                defaultOpen={false}
                className="mb-6"
              >
                {salonId ? <CashDisciplineCard salonId={salonId} /> : null}
              </CollapsibleSection>

              {/* Telegram-привязка для отправки багов в @finklay_dev_bot */}
              <CollapsibleSection
                id="settings.telegram_link"
                title={t('settings.telegram.title', { defaultValue: 'Telegram' })}
                defaultOpen={false}
                className="mb-6"
              >
                <TelegramLinkCard />
              </CollapsibleSection>

              {/* Сегментация клиентов перенесена в /staff (Справочник → Мастера) */}

              {/* Сравнение с рынком (benchmarks opt-in) */}
              <CollapsibleSection
                id="settings.benchmarks"
                title={t('settings.benchmarks.title')}
                defaultOpen={false}
                className="mb-6"
              >
                <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
                  <h2 className="text-brand-navy text-base font-bold tracking-tight">
                    {t('settings.benchmarks.title')}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t('settings.benchmarks.subtitle')}
                  </p>
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
                          onError: (err) => toast.error(formatError(err)),
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
              </CollapsibleSection>

              {/* Опасная зона — удаление салона */}
              <CollapsibleSection
                id="settings.delete_salon"
                title={t('settings.delete.title')}
                defaultOpen={false}
                className="mb-6"
              >
                <section className="border-destructive/30 bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
                  <h2 className="text-destructive mb-1 text-base font-bold tracking-tight">
                    {t('settings.delete.title')}
                  </h2>
                  <p className="text-muted-foreground mb-4 text-sm">
                    {t('settings.delete.subtitle')}
                  </p>
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
              </CollapsibleSection>
            </>
          )}
        </>
      )}

      {activeTab === 'catalogs' && (
        <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('settings.catalogs.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('settings.catalogs.subtitle')}</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CatalogCard
              to={`/${salonId}/staff`}
              icon={Scissors}
              title={t('settings.catalogs.items.staff.title')}
              subtitle={t('settings.catalogs.items.staff.subtitle')}
            />
            <CatalogCard
              to={`/${salonId}/services`}
              icon={Sparkles}
              title={t('settings.catalogs.items.services.title')}
              subtitle={t('settings.catalogs.items.services.subtitle')}
            />
            <CatalogCard
              to={`/${salonId}/reports?tab=clients&client=list`}
              icon={Users}
              title={t('settings.catalogs.items.clients.title')}
              subtitle={t('settings.catalogs.items.clients.subtitle')}
            />
            <CatalogCard
              to={`/${salonId}/settings/finance-catalog`}
              icon={Wallet}
              title={t('settings.catalogs.items.finance.title')}
              subtitle={t('settings.catalogs.items.finance.subtitle')}
            />
            <CatalogCard
              to={`/${salonId}/settings/counterparties`}
              icon={Users}
              title={t('settings.catalogs.items.counterparties.title')}
              subtitle={t('settings.catalogs.items.counterparties.subtitle')}
            />
            {/* «Склад» удалён отсюда — он на своей странице /inventory. */}
          </div>
        </section>
      )}

      {activeTab === 'security' && (
        <>
          {/* 2FA */}
          <div className="mb-6">
            <MFACard />
          </div>

          {/* Bug (баг-трекер): «Экспорт данных» и «Журнал событий» — owner-only.
              Мастеру (staff/external) в «Безопасности» оставляем только 2FA. */}
          {!restrictOwnerTabs && (
            <>
              {/* Экспорт данных */}
              <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-brand-navy text-base font-bold tracking-tight">
                      {t('settings.export.title')}
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t('settings.export.subtitle')}
                    </p>
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

              {/* Журнал событий */}
              <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-brand-navy text-base font-bold tracking-tight">
                      {t('settings.audit.title')}
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t('settings.audit.subtitle')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => navigate(`/${salonId}/settings/audit`)}
                  >
                    <History className="size-4" strokeWidth={1.7} />
                    {t('settings.audit.button')}
                  </Button>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {activeTab === 'schedule' && <ScheduleTab />}

      {activeTab === 'notifications' && <NotificationsTabContent salon={salon} />}

      {activeTab === 'api' && (
        <>
          <div className="mb-6">
            <ApiKeysCard />
          </div>

          {/* Docs link */}
          <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-brand-navy text-base font-bold tracking-tight">
                  {t('settings.api.docs_title')}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t('settings.api.docs_subtitle')}
                </p>
              </div>
              <Link
                to="/docs/api"
                target="_blank"
                rel="noopener noreferrer"
                className="border-border bg-card hover:bg-muted/40 inline-flex h-11 items-center gap-2 rounded-md border px-4 text-sm font-semibold"
              >
                {t('settings.api.docs_link')}
              </Link>
            </div>
          </section>

          {/* Quick how-to */}
          <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.api.howto_title')}
            </h2>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-1.5 pl-5 text-sm">
              <li>{t('settings.api.howto_step1')}</li>
              <li>{t('settings.api.howto_step2')}</li>
              <li>{t('settings.api.howto_step3')}</li>
              <li>{t('settings.api.howto_step4')}</li>
            </ol>
            <pre className="bg-muted/40 mt-4 overflow-x-auto rounded-md p-3 text-xs">
              {`curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  ${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-api/v1/visits?from=2026-06-01&to=2026-06-30`}
            </pre>
          </section>
        </>
      )}

      {activeTab === 'integrations' && <IntegrationsContent />}

      {activeTab === 'billing' && (
        <>
          {/* Подписка (фича L): карточка текущего тарифа + смена тарифа +
              инвойсы/платежи. Реальный план берётся из effectivePlan
              (salon_subscriptions + implicit-trial) внутри BillingButtons. */}
          <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-brand-navy text-base font-bold tracking-tight">
                  {t('settings.billing.title')}
                </h2>
                <BillingSubscriptionStatus
                  subscription={subscription ?? null}
                  salonCreatedAt={salon.created_at}
                />
              </div>
              <BillingButtons salonId={salonId} subscription={subscription ?? null} />
            </div>
          </section>
        </>
      )}

      {activeTab === 'team' && (
        /* Команда — раньше открывалась на отдельной странице через
           «Управлять командой». По требованию владельца — рендерим
           содержимое inline здесь же. TeamPage в режиме inline скрывает
           свой заголовок и back-link (общая шапка Settings уже есть). */
        <TeamPage inline />
      )}

      {activeTab === 'help' && (
        <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('settings.help.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('settings.help.subtitle')}</p>
          </div>
          <HelpFAQ />
          <p className="text-muted-foreground mt-4 text-xs">
            {t('settings.help.full_page_hint')}{' '}
            <Link to={`/${salonId}/help`} className="text-primary font-semibold hover:underline">
              {t('settings.help.full_page_link')}
            </Link>
          </p>
        </section>
      )}

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
              placeholder={t('settings.delete.confirm_placeholder')}
              autoFocus
              autoComplete="off"
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

      <ImageCropper
        file={logoCropFile}
        aspect={null}
        maxOutputSize={512}
        onCancel={() => setLogoCropFile(null)}
        onCrop={async (blob) => {
          if (!salon) return
          try {
            setLogoUploading(true)
            const url = await uploadSalonLogo(salon.id, blob, 'webp')
            setLogoUrl(url)
            toast.success(t('settings.profile.logo_uploaded'))
            setLogoCropFile(null)
          } catch (err) {
            toast.error(formatError(err))
          } finally {
            setLogoUploading(false)
          }
        }}
      />
    </div>
  )
}

/**
 * Settings → График работы. Две подвкладки:
 *   - schedule.hours    — SalonHoursCard (часы по дням недели)
 *   - schedule.holidays — SalonHolidaysCard (праздники, госвыходные)
 *
 * Активная подвкладка хранится в URL (?sub=...), чтобы deep-link был
 * стабилен и переключение не сбрасывало другие параметры.
 */
function ScheduleTab() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const sub = (params.get('sub') as 'hours' | 'holidays' | null) ?? 'hours'
  function setSub(next: 'hours' | 'holidays') {
    const p = new URLSearchParams(params)
    p.set('sub', next)
    setParams(p, { replace: true })
  }
  return (
    <div>
      <PageTabsNav
        tabs={[
          {
            id: 'hours' as const,
            labelKey: 'settings.schedule.tabs.hours',
            icon: Clock,
          },
          {
            id: 'holidays' as const,
            labelKey: 'settings.schedule.tabs.holidays',
            icon: Calendar,
          },
        ]}
        active={sub}
        onChange={setSub}
        t={t}
      />
      <div className="mt-4">{sub === 'hours' ? <SalonHoursCard /> : <SalonHolidaysCard />}</div>
    </div>
  )
}

// DigestChannelsField и digestSentToastText переехали в
// NotificationsTabContent.tsx — sub-tab «Каналы» использует ту же логику.
