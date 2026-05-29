import { useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { BrandIcon } from './BrandIcon'
import type { OnboardingIntegration as OnboardingIntegrationType } from './OnboardingPage'

/** T133 — wrapper над BrandIcon чтобы matched LucideIcon signature
 *  (нужен для items.icon в IntegrationCategoryStep). */
function makeBrandIcon(provider: OnboardingIntegrationType): LucideIcon {
  const Icon = (props: { className?: string }) => (
    <BrandIcon provider={provider} className={props.className} />
  )
  Icon.displayName = `BrandIcon(${provider})`
  return Icon as unknown as LucideIcon
}
const BooksyIcon = makeBrandIcon('booksy')
const FreshaIcon = makeBrandIcon('fresha')
const TreatwellIcon = makeBrandIcon('treatwell')
const YclientsIcon = makeBrandIcon('yclients')
const InstagramIcon = makeBrandIcon('instagram')
const FacebookIcon = makeBrandIcon('facebook')
const TelegramIcon = makeBrandIcon('telegram')
const BankingIcon = makeBrandIcon('banking')

import { Button } from '@/components/ui/button'
import { LogoLockup } from '@/components/ui/logo'
import { useAuth } from '@/hooks/useAuth'
import { DEFAULT_FINANCIAL_SETTINGS, type FinancialSettings } from '@/hooks/useFinancialSettings'
import { detectCountryByIp } from '@/lib/detect-country'
import { saveOnboardingTransit } from '@/lib/onboarding-credentials'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { rememberLastSalon } from '@/routes/RootRedirect'
import {
  COUNTRY_OPTIONS,
  DEFAULT_EXPENSE_CATEGORIES,
  SEED_SERVICES_BY_TYPE,
  type CountryCode,
  type SalonTypeId,
} from './onboarding-defaults'
import { IntegrationCategoryStep } from './IntegrationCategoryStep'
import { LiveIntegrationCategoryStep } from './LiveIntegrationCategoryStep'
import { OcrManualBookingsBlock } from './OcrManualBookingsBlock'
import { type ParsedVisit } from './OcrNotebookButton'
import { StepAiBreakdown } from './StepAiBreakdown'
import { StepAiSummary } from './StepAiSummary'
import { StepPublicLinks } from './StepPublicLinks'
import { Step0Path, type OnboardingPath } from './Step0Path'
import { StepSchedule, type OpeningHoursDraft } from './StepSchedule'
import { StepTelegramPhone } from './StepTelegramPhone'
import { StepUserProfile } from './StepUserProfile'
import { StepWelcome } from './StepWelcome'
import { StepWowAi } from './StepWowAi'
import { Step1Salon } from './Step1Salon'
import { Step2Address, type AddressDraft } from './Step2Address'
import { Step2Staff, type StaffDraft } from './Step2Staff'
import { Step2StaffLive } from './Step2StaffLive'
import { Step3Accounting, type AccountingMode } from './Step3Accounting'
import { AccountingSettingsCard } from '@/routes/settings/AccountingSettingsCard'
import { ShieldCheck } from 'lucide-react'
import { Step3Services, type ServiceDraft } from './Step3Services'
import { Step3ServicesLive } from './Step3ServicesLive'
import { Step4Expenses } from './Step4Expenses'
import { Step5Done } from './Step5Done'
import { TutorialNote } from './TutorialNote'

const STEPS_QUICK = [
  'welcome',
  'path',
  'profile',
  'salon',
  'integrations_bookings',
  'integrations_social',
  'integrations_banking',
  'tg_phone',
  'wow',
  // T157 — даже в быстрой ветке показываем общий AI-анализ. Это главная
  // wow-фича, юзер должен её увидеть.
  'ai_summary',
  'done',
] as const
const STEPS_FULL = [
  'welcome',
  'path',
  'profile',
  'salon',
  'schedule',
  'address',
  'public_links',
  'accounting',
  'integrations_bookings',
  'integrations_social',
  'integrations_banking',
  'tg_phone',
  'staff',
  'services',
  'expenses',
  'ai_services',
  'ai_staff',
  'ai_clients',
  'ai_reviews',
  'ai_summary',
  'done',
] as const
type StepId = (typeof STEPS_FULL)[number] | (typeof STEPS_QUICK)[number]

export type OnboardingIntegration =
  | 'booksy'
  | 'wfirma'
  | 'banking'
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'telegram'
  | 'ical'
  | 'ocr_notebook'
  // T107 — бухгалтерия
  | 'ksef'
  | 'fakturownia'
  | 'ifirma'
  | 'infakt'
  // Booking-провайдеры в очереди (coming_soon в UI)
  | 'fresha'
  | 'treatwell'
  | 'yclients'

export type OnboardingState = {
  // Шаг 0 — путь (быстрый/полный). null = ещё не выбран.
  path: OnboardingPath | null
  // Шаг 1
  name: string
  country_code: CountryCode
  salon_type: SalonTypeId
  // Шаг 2 — Address (только full path)
  address: AddressDraft
  // Шаг 3 — Accounting (только full path)
  nip: string
  company_name: string
  // Staff
  staff: StaffDraft[]
  // Services
  services: ServiceDraft[]
  // Expenses
  expense_categories: string[]
  // Done
  benchmarks_opt_in: boolean
  selected_integrations: OnboardingIntegration[]
  /** В Done step: после submit редиректить в Stripe Checkout (trial 14д). */
  subscribe_after_submit: boolean
  /** T81 — data URL логотипа (webp blob) из ImageCropper. Заливается в
   *  Storage после создания салона (надо salon_id для RLS). NULL — без логотипа. */
  logo_data_url: string | null
  // T96 — профиль юзера
  first_name: string
  last_name: string
  avatar_data_url: string | null
  // T97 — телефон + желание подключить Telegram
  phone: string
  want_telegram: boolean
  // T98 — opening hours (full path only)
  opening_hours: OpeningHoursDraft
  // T102 — визиты, распознанные AI из фото блокнота. Импортируем после
  // создания салона как обычные visits.
  ocr_visits: ParsedVisit[]
  // T103 — публичные ссылки (полная ветка)
  booksy_url: string
  instagram_url: string
  facebook_url: string
  // T106 — структурированный financial_settings из 7 категорий. После
  // submit сохраняется в salons.financial_settings jsonb.
  financial_settings: FinancialSettings
  /** T138 — как ведёт бухгалтерию. По выбору фильтруем релевантных провайдеров. */
  accounting_mode: AccountingMode | null
  /** T129 — credentials собранные в ConnectIntegrationDialog. После создания
   *  салона мы вызываем соответствующие connect-функции с этими данными. */
  pending_credentials: Partial<Record<OnboardingIntegration, PendingCredentials>>
  /** Early-create salon ID. Создаётся после Step "salon" — даёт реальный
   *  salonId для последующих integration steps (Booksy/Banking/Telegram/
   *  Meta OAuth/etc), чтобы юзер реально подключал интеграции прямо в
   *  онбординге, а не получал плашку «подключено». */
  created_salon_id: string | null
}

/** T129 — credentials для одной интеграции (email/password/token/etc.). */
export type PendingCredentials = Record<string, string>

const INITIAL: OnboardingState = {
  path: null,
  name: '',
  country_code: 'PL',
  salon_type: 'hair',
  address: {
    address: '',
    city: '',
    lat: '',
    lng: '',
    google_place_id: null,
    google_place_url: null,
  },
  nip: '',
  company_name: '',
  staff: [],
  services: [],
  expense_categories: [...DEFAULT_EXPENSE_CATEGORIES],
  benchmarks_opt_in: true, // дефолт ON — большинство соглашается, можно выключить
  selected_integrations: [],
  logo_data_url: null,
  first_name: '',
  last_name: '',
  avatar_data_url: null,
  phone: '',
  want_telegram: true,
  opening_hours: {
    mon: { open: '09:00', close: '20:00' },
    tue: { open: '09:00', close: '20:00' },
    wed: { open: '09:00', close: '20:00' },
    thu: { open: '09:00', close: '20:00' },
    fri: { open: '09:00', close: '20:00' },
    sat: { open: '10:00', close: '18:00' },
    sun: { closed: true },
  },
  ocr_visits: [],
  booksy_url: '',
  instagram_url: '',
  facebook_url: '',
  financial_settings: DEFAULT_FINANCIAL_SETTINGS,
  accounting_mode: null,
  pending_credentials: {},
  // bug ee00e1a7 — отключаем требование привязки карты в первых шагах.
  // Юзер хочет полностью бесшовный trial: попадает в /dashboard сразу,
  // без редиректа в Stripe Checkout. Активация подписки переехала в
  // /settings/billing где юзер увидит CTA «Активировать».
  // T164 — после T159 (paywall UI убран) дефолт включён: каждый юзер
  // после онбординга идёт через Stripe Checkout с 14-дневным trial.
  // Если юзеру не нужна подписка — отключит в Settings → Биллинг после первого
  // dashboard'a.
  subscribe_after_submit: true,
  created_salon_id: null,
}

export function OnboardingPage() {
  const { t, i18n } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [stepIndex, setStepIndex] = useState(0)
  const [state, setState] = useState<OnboardingState>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // IP-based auto-detect страны (только если ещё не hydrated из БД).
  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    detectCountryByIp().then((cc) => {
      if (cancelled || !cc) return
      setState((prev) => (prev.country_code === 'PL' ? { ...prev, country_code: cc } : prev))
    })
    return () => {
      cancelled = true
    }
  }, [hydrated])

  // Resume: если в query ?salon=<id> или у юзера в БД есть unfinished
  // salon (onboarding_completed_at IS NULL) — подтянем сохранённый state
  // и stepId. ADR-030 + миграция 20260529000005.
  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      try {
        const cols =
          'id, onboarding_state, onboarding_step_id, onboarding_completed_at, opening_hours, address, city, lat, lng, google_place_id, google_place_url'
        const querySalonId = searchParams.get('salon')
        const querySalon = querySalonId
          ? await supabase.from('salons').select(cols).eq('id', querySalonId).maybeSingle()
          : null
        const myUnfinishedRes = querySalon?.data
          ? null
          : await supabase
              .from('salons')
              .select(cols)
              .is('onboarding_completed_at', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
        const row = (querySalon?.data ?? myUnfinishedRes?.data) as {
          id: string
          onboarding_state: OnboardingState | null
          onboarding_step_id: string | null
          onboarding_completed_at: string | null
          opening_hours: OpeningHoursDraft | null
          address: string | null
          city: string | null
          lat: number | null
          lng: number | null
          google_place_id: string | null
          google_place_url: string | null
        } | null
        if (cancelled || !row || row.onboarding_completed_at) return
        // Booksy импортирует opening_hours и Google Place — подтягиваем
        // из salons чтобы юзер видел реальный график/адрес, а не дефолтный
        // 09:00-20:00.
        const dbExtras: Partial<OnboardingState> = {}
        if (row.opening_hours) dbExtras.opening_hours = row.opening_hours
        if (row.address || row.city || row.google_place_id) {
          dbExtras.address = {
            address: row.address ?? '',
            city: row.city ?? '',
            lat: row.lat != null ? String(row.lat) : '',
            lng: row.lng != null ? String(row.lng) : '',
            google_place_id: row.google_place_id,
            google_place_url: row.google_place_url,
          }
        }
        if (row.onboarding_state) {
          setState({ ...row.onboarding_state, ...dbExtras, created_salon_id: row.id })
        } else {
          setState((prev) => ({ ...prev, ...dbExtras, created_salon_id: row.id }))
        }
        // stepId восстановим после первого render (нужен STEPS массив).
        if (row.onboarding_step_id) {
          requestAnimationFrame(() => {
            setState((cur) => {
              const list = cur.path === 'full' ? STEPS_FULL : STEPS_QUICK
              const idx = (list as readonly string[]).indexOf(row.onboarding_step_id!)
              if (idx >= 0) setStepIndex(idx)
              return cur
            })
          })
        }
      } catch (err) {
        console.warn('onboarding hydrate failed', err)
      } finally {
        if (!cancelled) setHydrated(true)
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave: при изменении state/stepIndex (после hydrate) пишем snapshot
  // в salons.onboarding_state + onboarding_step_id. Debounced 1.5s чтобы
  // не флудить запросами при типе/кликах.
  useEffect(() => {
    if (!hydrated || !state.created_salon_id) return
    const sid = state.created_salon_id
    const stepId = ((state.path === 'full' ? STEPS_FULL : STEPS_QUICK) as readonly string[])[
      stepIndex
    ]
    const timer = window.setTimeout(() => {
      supabase
        .from('salons')
        .update({
          onboarding_state: state,
          onboarding_step_id: stepId,
        })
        .eq('id', sid)
        .then(({ error }) => {
          if (error) console.warn('onboarding autosave failed', error)
        })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [state, stepIndex, hydrated])

  // STEPS зависят от выбранного пути: пока не выбран — только path-шаг.
  // Address-шаг скипаем если на Step "salon" юзер уже выбрал место в Google
  // Maps — адрес, координаты и google_place_id оттуда подтянулись, ещё раз
  // показывать форму нет смысла.
  const STEPS: readonly StepId[] = (state.path === 'full' ? STEPS_FULL : STEPS_QUICK).filter(
    (s) => !(s === 'address' && state.address.google_place_id),
  )
  const stepId: StepId = (STEPS[stepIndex] ?? 'path') as StepId
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  // Когда юзер впервые попадает на шаг 3, наполним услугами по типу салона
  function ensureServicesSeed(typeId: SalonTypeId, current: ServiceDraft[]): ServiceDraft[] {
    if (current.length > 0) return current
    return SEED_SERVICES_BY_TYPE[typeId].map((s, i) => ({ ...s, id: `seed-${i}` }))
  }

  function patch<K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  /** Early-create salon после Step "salon" — даёт реальный salonId для
   *  последующих integration steps. Если уже создан и юзер изменил
   *  name/country/type — обновляем salons row. */
  async function ensureSalonCreated(): Promise<string | null> {
    if (state.created_salon_id) {
      // Update только базовых полей (name/type/country may have changed)
      try {
        await supabase
          .from('salons')
          .update({
            name: state.name.trim(),
            salon_type: state.salon_type,
            country_code: state.country_code,
          })
          .eq('id', state.created_salon_id)
      } catch (err) {
        console.warn('salon update failed', err)
      }
      return state.created_salon_id
    }
    if (!state.name.trim()) return null
    const country = COUNTRY_OPTIONS.find((c) => c.code === state.country_code)!
    const { data, error } = await supabase.rpc('create_salon_with_setup', {
      p_name: state.name.trim(),
      p_country_code: country.code,
      p_currency: country.currency,
      p_timezone: country.timezone,
      p_salon_type: state.salon_type,
      p_locale: i18n.language.split('-')[0] || 'ru',
    })
    if (error) {
      console.warn('early-create salon failed', error.message)
      return null
    }
    const newSalonId = data as unknown as string
    setState((prev) => ({ ...prev, created_salon_id: newSalonId }))
    rememberLastSalon(newSalonId)
    await queryClient.refetchQueries({ queryKey: ['salons'] })
    return newSalonId
  }

  async function next() {
    if (stepIndex === 1) {
      patch('services', ensureServicesSeed(state.salon_type, state.services))
    }
    // Early-create после Step "salon" — если юзер ввёл имя, создаём салон.
    if (stepId === 'salon' && state.name.trim()) {
      await ensureSalonCreated()
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }

  function back() {
    setStepIndex((i) => Math.max(0, i - 1))
  }

  function skip() {
    next()
  }

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    let newSalonId = state.created_salon_id
    // Если early-create не сработал (юзер пропустил salon шаг, или сбой
    // RPC) — создаём салон сейчас с полным набором staff/services.
    if (!newSalonId) {
      const country = COUNTRY_OPTIONS.find((c) => c.code === state.country_code)!
      const { data, error } = await supabase.rpc('create_salon_with_setup', {
        p_name: state.name.trim(),
        p_country_code: country.code,
        p_currency: country.currency,
        p_timezone: country.timezone,
        p_salon_type: state.salon_type,
        p_locale: 'ru',
        p_staff: state.staff
          .filter((s) => s.full_name.trim())
          .map((s) => ({ full_name: s.full_name.trim(), payout_percent: s.payout_percent })),
        p_services: state.services
          .filter((s) => s.name.trim())
          .map((s) => ({
            category_name: s.category_name,
            name: s.name.trim(),
            default_price_cents: s.default_price_cents,
          })),
        p_expense_categories: state.expense_categories.filter((c) => c.trim()),
      })
      if (error) {
        setSubmitting(false)
        setSubmitError(error.message)
        return
      }
      newSalonId = data as unknown as string
    } else {
      // Early-create уже сделал салон без staff/services/expense_categories.
      // Доинсёртим их сейчас. Используем тот же RPC — но через update path:
      // INSERT staff/services/expense_categories напрямую (RPC так не умеет
      // после факта). Сохраняем только не-пустые записи.
      const staffRows = state.staff
        .filter((s) => s.full_name.trim())
        .map((s) => ({
          salon_id: newSalonId!,
          full_name: s.full_name.trim(),
          payout_scheme: 'percent_revenue' as const,
          payout_percent: Math.max(0, Math.min(100, s.payout_percent ?? 40)),
        }))
      if (staffRows.length > 0) {
        try {
          await supabase.from('staff').insert(staffRows)
        } catch (err) {
          console.warn('staff insert failed', err)
        }
      }
      const expCats = state.expense_categories.filter((c) => c.trim())
      if (expCats.length > 0) {
        try {
          await supabase.from('expense_categories').insert(
            expCats.map((c, idx) => ({
              salon_id: newSalonId!,
              name: c.trim(),
              is_system: true,
              sort_order: idx,
            })),
          )
        } catch (err) {
          console.warn('expense_categories insert failed', err)
        }
      }
      const servicesByCategory = new Map<string, string>()
      for (const s of state.services) {
        if (!s.name.trim() || !s.category_name) continue
        if (!servicesByCategory.has(s.category_name)) {
          try {
            const { data: cat } = await supabase
              .from('service_categories')
              .insert({
                salon_id: newSalonId!,
                name: s.category_name,
                sort_order: servicesByCategory.size,
              })
              .select('id')
              .single()
            if (cat?.id) servicesByCategory.set(s.category_name, cat.id as string)
          } catch (err) {
            console.warn('service_category insert failed', err)
          }
        }
      }
      const servicesRows = state.services
        .filter((s) => s.name.trim())
        .map((s) => ({
          salon_id: newSalonId!,
          category_id: s.category_name ? (servicesByCategory.get(s.category_name) ?? null) : null,
          name: s.name.trim(),
          default_price_cents: s.default_price_cents ?? 0,
        }))
      if (servicesRows.length > 0) {
        try {
          await supabase.from('services').insert(servicesRows)
        } catch (err) {
          console.warn('services insert failed', err)
        }
      }
    }
    // Доп. поля из full path (если заданы) — обновляем салон после создания.
    // create_salon_with_setup RPC принимает только базовые параметры; address,
    // координаты, NIP — настройки которые юзер мог пропустить на quick path.
    const extraPatch: Record<string, unknown> = {}
    if (!state.benchmarks_opt_in) extraPatch.benchmarks_opt_in = false
    if (state.address.address.trim()) extraPatch.address = state.address.address.trim()
    if (state.address.city.trim()) extraPatch.city = state.address.city.trim()
    if (state.address.lat.trim()) {
      const v = Number(state.address.lat.replace(',', '.'))
      if (Number.isFinite(v)) extraPatch.lat = v
    }
    if (state.address.lng.trim()) {
      const v = Number(state.address.lng.replace(',', '.'))
      if (Number.isFinite(v)) extraPatch.lng = v
    }
    if (state.address.google_place_id) extraPatch.google_place_id = state.address.google_place_id
    if (state.address.google_place_url) extraPatch.google_place_url = state.address.google_place_url
    // T103 — публичные ссылки в salons
    if (state.booksy_url.trim()) extraPatch.booksy_url = state.booksy_url.trim()
    if (state.instagram_url.trim()) extraPatch.instagram_url = state.instagram_url.trim()
    if (state.facebook_url.trim()) extraPatch.facebook_url = state.facebook_url.trim()
    // T106 — структурированный financial_settings (только для full ветки).
    // В quick — пропускаем, бэкенд возьмёт DEFAULT_FINANCIAL_SETTINGS.
    if (state.path === 'full') {
      extraPatch.financial_settings = state.financial_settings
    }
    if (state.nip.trim()) {
      // Бухгалтерия живёт в accounting_settings jsonb (миграция 20260516000002).
      // Merge через accounting_settings — но проще держать в отдельных колонках:
      // если их нет, накопится в local-only поле. Используем JSON merge.
      const { data: cur } = await supabase
        .from('salons')
        .select('accounting_settings')
        .eq('id', newSalonId)
        .maybeSingle()
      const acc = ((cur as { accounting_settings?: Record<string, unknown> } | null)
        ?.accounting_settings ?? {}) as Record<string, unknown>
      extraPatch.accounting_settings = {
        ...acc,
        nip: state.nip.trim(),
        company_name: state.company_name.trim() || null,
      }
    }
    // T96-T98 — сохраняем профиль юзера и opening_hours салона.
    const fullName = `${state.first_name.trim()} ${state.last_name.trim()}`.trim()
    if (fullName || state.phone.trim()) {
      const profilePatch: Record<string, unknown> = {}
      if (fullName) profilePatch.full_name = fullName
      if (state.phone.trim()) profilePatch.phone = state.phone.trim()
      const { data: userResp } = await supabase.auth.getUser()
      const userId = userResp.user?.id
      if (userId) {
        try {
          await supabase.from('profiles').update(profilePatch).eq('id', userId)
        } catch (err) {
          console.warn('profile update failed', err)
        }
        // T96 — аватар в avatars bucket (путь <auth.uid()>/...)
        if (state.avatar_data_url) {
          try {
            const blob = await (await fetch(state.avatar_data_url)).blob()
            const path = `${userId}/avatar-${Date.now()}.webp`
            const up = await supabase.storage
              .from('avatars')
              .upload(path, blob, { upsert: true, contentType: 'image/webp' })
            if (!up.error) {
              const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
              await supabase.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', userId)
            }
          } catch (err) {
            console.warn('avatar upload failed', err)
          }
        }
      }
    }
    // T98 — рабочий график в salon.opening_hours
    if (state.path === 'full') {
      extraPatch.opening_hours = state.opening_hours
    }

    // T81 — заливаем логотип в salon-logos bucket (если был выбран). Это
    // делается ПОСЛЕ создания салона, потому что bucket-policy требует
    // salon_id в первом компоненте пути.
    if (state.logo_data_url) {
      try {
        const blob = await (await fetch(state.logo_data_url)).blob()
        const path = `${newSalonId}/${crypto.randomUUID()}.webp`
        const up = await supabase.storage
          .from('salon-logos')
          .upload(path, blob, { upsert: false, contentType: 'image/webp', cacheControl: '3600' })
        if (!up.error) {
          const { data: pub } = supabase.storage.from('salon-logos').getPublicUrl(path)
          extraPatch.logo_url = pub.publicUrl
        }
      } catch (err) {
        console.warn('logo upload failed', err)
      }
    }

    // ADR-030 — отмечаем салон как «прошёл финальный submit» (не brown).
    // Делается всегда — без этого cleanup-cron удалит салон через 7 дней.
    extraPatch.onboarding_completed_at = new Date().toISOString()
    await supabase.from('salons').update(extraPatch).eq('id', newSalonId)

    // T108 — импорт OCR-визитов как реальных записей в visits таблицу.
    // visit_at: парсим из date или ставим now() как fallback.
    // status='paid' (если есть amount) или 'pending'. Без staff_id/client_id
    // — попозже юзер привяжет вручную. amount_cents = amount × 100.
    if (state.ocr_visits.length > 0) {
      try {
        const rows = state.ocr_visits.map((v) => {
          const dateStr = v.date ?? ''
          let visitAt = new Date().toISOString()
          if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
            const parsed = new Date(`${dateStr}T12:00:00Z`)
            if (!isNaN(parsed.getTime())) visitAt = parsed.toISOString()
          }
          const amountCents =
            v.amount != null && Number.isFinite(v.amount) ? Math.round(Number(v.amount) * 100) : 0
          return {
            salon_id: newSalonId,
            visit_at: visitAt,
            amount_cents: amountCents,
            tip_cents: 0,
            discount_cents: 0,
            payment_method: 'cash',
            status: amountCents > 0 ? 'paid' : 'pending',
            service_name_snapshot: v.service ?? null,
            source: 'ocr_notebook',
            kind: 'visit',
            comment: v.raw ?? null,
          }
        })
        const { error: insErr } = await supabase.from('visits').insert(rows)
        if (insErr) console.warn('ocr_visits insert failed', insErr.message)
      } catch (err) {
        console.warn('ocr_visits insert exception', err)
      }
    }

    // T109 — отправка приглашений мастерам с invite=true и email. Для
    // каждого мастера: insert в salon_invitations + триггер send-invitation
    // (email с deep-link). RPC create_salon_with_setup уже создал staff
    // rows — мы линкуем invitation к существующему staff по full_name.
    const staffToInvite = state.staff.filter(
      (s) => s.invite && s.email && s.email.trim() && s.full_name.trim(),
    )
    if (staffToInvite.length > 0) {
      try {
        // Подгружаем staff_id'ы только что созданных мастеров — для линка.
        const { data: createdStaff } = await supabase
          .from('staff')
          .select('id, full_name')
          .eq('salon_id', newSalonId)
        const staffByName = new Map(
          (createdStaff ?? []).map((s) => [s.full_name.trim().toLowerCase(), s.id]),
        )
        for (const s of staffToInvite) {
          const linkedStaffId = staffByName.get(s.full_name.trim().toLowerCase()) ?? null
          try {
            await supabase.functions.invoke('send-invitation', {
              body: {
                salon_id: newSalonId,
                email: s.email!.trim(),
                role: 'staff',
                staff_id: linkedStaffId,
                invited_first_name: s.full_name.split(' ')[0] ?? null,
                invited_last_name: s.full_name.split(' ').slice(1).join(' ') || null,
                invited_phone: s.phone?.trim() || null,
              },
            })
          } catch (e) {
            console.warn(`invite for ${s.email} failed:`, e)
          }
        }
      } catch (err) {
        console.warn('staff invitations exception', err)
      }
    }

    rememberLastSalon(newSalonId)
    // Кэш `useMySalons` не знает о только что созданном салоне.
    // invalidateQueries сам по себе не блокирующий — SalonLayout мог бы
    // отрендериться раньше и редиректнуть «нет салона» → /. Поэтому
    // awaiting refetch прямо здесь, до navigate.
    await queryClient.refetchQueries({ queryKey: ['salons'] })
    // Welcome-письмо в фоне — не блокирует navigate, ошибка email не должна
    // ломать UX онбординга (Postmark может тупить, sender signature пропасть).
    void triggerWelcomeEmail(newSalonId, state.name.trim())

    // T179+T199 — сохраняем credentials + prompt в один localStorage entry
    // (finkley:onboarding:<salonId>). После Stripe redirect (success или
    // cancel) IntegrationsPage прочитает оба. Раньше было 2 отдельных
    // localStorage ключа — упрощено в T199.
    const hasCredentials = Object.values(state.pending_credentials).some(
      (c) => c && Object.keys(c).length > 0,
    )
    const hasPrompt = state.selected_integrations.length > 0
    if (hasCredentials || hasPrompt) {
      saveOnboardingTransit(newSalonId, {
        credentials: hasCredentials ? state.pending_credentials : undefined,
        prompt: hasPrompt ? state.selected_integrations.join(',') : undefined,
      })
    }

    // Paywall: если юзер не снял чек-бокс «активировать trial» — редиректим
    // в Stripe Checkout (мode=subscription, trialDays=14). Стандартный
    // success_url возвращает на settings?stripe=success → дальше dashboard.
    if (state.subscribe_after_submit) {
      try {
        const { data: checkoutData, error: checkoutErr } = await supabase.functions.invoke(
          'create-checkout-session',
          {
            body: {
              salonId: newSalonId,
              // T186 — Stripe success/cancel вернёт сюда с prompt,
              // IntegrationsPage откроет цепочку connect dialog'ов.
              prompt: state.selected_integrations.join(','),
            },
          },
        )
        const url = (checkoutData as { url?: string } | null)?.url
        if (url && !checkoutErr) {
          window.location.href = url
          return
        }
        // Если что-то пошло не так — не валим онбординг, просто едем на dashboard.
        console.warn('create-checkout-session failed:', checkoutErr)
      } catch (e) {
        console.warn('create-checkout-session threw:', e)
      }
    }

    // T199 — credentials + prompt уже сохранены в один localStorage entry
    // выше (saveOnboardingTransit), перед Stripe redirect. Не дублируем.

    // Если юзер выбрал интеграции — отправляем сразу на settings/integrations,
    // чтобы он подключил их (там полноценные OAuth-флоу). Иначе — на dashboard.
    if (state.selected_integrations.length > 0) {
      const params = new URLSearchParams({
        tab: 'integrations',
        prompt: state.selected_integrations.join(','),
      })
      navigate(`/${newSalonId}/settings?${params.toString()}`, { replace: true })
    } else {
      navigate(`/${newSalonId}/dashboard`, { replace: true })
    }
  }

  async function triggerWelcomeEmail(salonId: string, salonName: string) {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      // i18n.language: подхватываем язык интерфейса в момент онбординга,
      // чтобы welcome пришёл на нужном языке (а не на дефолтном ru).
      const locale = i18n.language?.split('-')[0] ?? 'ru'
      await fetch(`${SUPABASE_URL}/functions/v1/notify-welcome`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ salon_id: salonId, salon_name: salonName, locale }),
      })
    } catch (err) {
      console.warn('welcome email trigger failed', err)
    }
  }

  // Валидация перехода. Step5 — терминальный, переход = submit.
  function canProceed(): boolean {
    if (stepId === 'path') return state.path !== null
    if (stepId === 'salon') return state.name.trim().length >= 2
    return true
  }

  /** Продающая CTA-кнопка вместо нейтрального «Далее →». Подбирается под
   *  смысл шага: на welcome — «Начать зарабатывать больше», на интеграциях
   *  — «Подключить и сэкономить часы рутины», и т.п. */
  function nextCtaLabel(): string {
    switch (stepId) {
      case 'welcome':
        return t('onboarding.cta.welcome')
      case 'path':
        return t('onboarding.cta.path')
      case 'salon':
        return t('onboarding.cta.salon')
      case 'address':
        return t('onboarding.cta.address')
      case 'accounting':
        return t('onboarding.cta.accounting')
      case 'integrations_bookings':
        return t('onboarding.cta.integrations_bookings')
      case 'integrations_social':
        return t('onboarding.cta.integrations_social')
      case 'integrations_banking':
        return t('onboarding.cta.integrations_banking')
      case 'wow':
        return t('onboarding.cta.wow')
      case 'profile':
        return t('onboarding.cta.profile')
      case 'tg_phone':
        return t('onboarding.cta.tg_phone')
      case 'schedule':
        return t('onboarding.cta.schedule')
      case 'public_links':
        return t('onboarding.cta.public_links')
      case 'ai_services':
        return t('onboarding.cta.ai_services')
      case 'ai_staff':
        return t('onboarding.cta.ai_staff')
      case 'ai_clients':
        return t('onboarding.cta.ai_clients')
      case 'ai_reviews':
        return t('onboarding.cta.ai_reviews')
      case 'staff':
        return t('onboarding.cta.staff')
      case 'services':
        return t('onboarding.cta.services')
      case 'expenses':
        return t('onboarding.cta.expenses')
      default:
        return `${t('common.next')} →`
    }
  }

  return (
    <div className="bg-background flex min-h-screen flex-col" data-testid="onboarding">
      <header className="border-border bg-card flex h-16 items-center justify-between border-b px-6 sm:px-9">
        <LogoLockup size={28} />
        <button
          type="button"
          onClick={signOut}
          className="text-muted-foreground hover:text-foreground text-sm font-medium"
          data-testid="onboarding-exit"
        >
          {t('onboarding.exit')}
        </button>
      </header>

      <main className="flex flex-1 justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[880px]">
          {/* Stepper */}
          <div className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-bold uppercase tracking-wider">
                {t('onboarding.step_of', { current: stepIndex + 1, total: STEPS.length })}
              </span>
              <span className="text-muted-foreground text-xs">{t('onboarding.eta')}</span>
            </div>
            {/* На full ветке 21 шаг — подписи под каждой полоской не помещаются
                в строку (разъезжаются на 2 строки, последние шаги ловят
                raw-ключ). Показываем подпись ТОЛЬКО под active шагом, для
                остальных — компактная полоска без подписи. */}
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => {
                const active = i === stepIndex
                const done = i < stepIndex
                return (
                  <div key={s} className="flex flex-1 flex-col items-center">
                    <div
                      className={cn(
                        'h-[5px] w-full rounded-full',
                        done ? 'bg-brand-sage' : active ? 'bg-primary' : 'bg-border',
                      )}
                    />
                    {active ? (
                      <div className="text-brand-navy mt-2 truncate text-[12px] font-bold">
                        {t(`onboarding.steps.${s}`)}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Step body */}
          <div data-testid={`onboarding-step-${stepId}`}>
            {stepId === 'welcome' && <StepWelcome />}
            {stepId === 'path' && (
              <Step0Path value={state.path} onChange={(v) => patch('path', v)} />
            )}
            {stepId === 'profile' && (
              <StepUserProfile
                value={{
                  first_name: state.first_name,
                  last_name: state.last_name,
                  avatar_data_url: state.avatar_data_url,
                }}
                onChange={(v) => setState((prev) => ({ ...prev, ...v }))}
              />
            )}
            {stepId === 'schedule' && (
              <StepSchedule
                value={state.opening_hours}
                onChange={(v) => patch('opening_hours', v)}
              />
            )}
            {stepId === 'tg_phone' && (
              <StepTelegramPhone
                value={{ phone: state.phone, want_telegram: state.want_telegram }}
                onChange={(v) => setState((prev) => ({ ...prev, ...v }))}
              />
            )}
            {stepId === 'salon' && (
              <>
                <Step1Salon
                  value={{
                    name: state.name,
                    country_code: state.country_code,
                    salon_type: state.salon_type,
                    address: state.address,
                    benchmarks_opt_in: state.benchmarks_opt_in,
                    logo_data_url: state.logo_data_url,
                  }}
                  onChange={(v) => setState((prev) => ({ ...prev, ...v }))}
                  showLogo={state.path === 'full'}
                />
              </>
            )}
            {/* End Step1Salon */}
            {stepId === 'address' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.address')}</TutorialNote>
                <Step2Address value={state.address} onChange={(v) => patch('address', v)} />
              </>
            )}
            {stepId === 'accounting' && (
              <>
                {/* Privacy-note сверху: данные не передаём третьим лицам,
                    нужны только для автоматизации доставки фактур/чеков
                    бухгалтеру. */}
                <div className="border-brand-teal-deep/30 bg-brand-teal-soft/20 mb-4 flex items-start gap-3 rounded-lg border-2 p-3">
                  <ShieldCheck
                    className="text-brand-teal-deep mt-0.5 size-5 shrink-0"
                    strokeWidth={2}
                  />
                  <p className="text-foreground/90 text-sm leading-snug">
                    {t('onboarding.step_accounting.privacy_note', {
                      defaultValue:
                        'Эти данные конфиденциальны. Мы не передаём их третьим лицам — они нужны только для автоматизации доставки фактур и чеков твоему бухгалтеру.',
                    })}
                  </p>
                </div>
                {state.created_salon_id ? (
                  <AccountingSettingsCard salonId={state.created_salon_id} />
                ) : (
                  <>
                    <TutorialNote>{t('onboarding.tutorial.accounting')}</TutorialNote>
                    <Step3Accounting
                      salonId={state.created_salon_id}
                      value={{ nip: state.nip, company_name: state.company_name }}
                      onChange={(v) =>
                        setState((prev) => ({
                          ...prev,
                          nip: v.nip,
                          company_name: v.company_name,
                        }))
                      }
                      selectedIntegrations={state.selected_integrations}
                      onToggleIntegration={(id) =>
                        patch(
                          'selected_integrations',
                          state.selected_integrations.includes(id)
                            ? state.selected_integrations.filter((x) => x !== id)
                            : [...state.selected_integrations, id],
                        )
                      }
                      accountingMode={state.accounting_mode ?? undefined}
                      onAccountingModeChange={(mode) => patch('accounting_mode', mode)}
                      credentials={state.pending_credentials}
                      onCredentialsChange={(id, creds) =>
                        patch('pending_credentials', {
                          ...state.pending_credentials,
                          [id]: creds ?? {},
                        })
                      }
                    />
                  </>
                )}
              </>
            )}
            {stepId === 'integrations_bookings' && (
              <OcrManualBookingsBlock
                salonId={state.created_salon_id}
                ocrVisits={state.ocr_visits}
                onOcrVisitsAdded={(v) => patch('ocr_visits', v)}
              />
            )}
            {stepId === 'integrations_bookings' &&
              (state.created_salon_id ? (
                <LiveIntegrationCategoryStep
                  title={t('onboarding.step_integrations.bookings_title')}
                  salonId={state.created_salon_id}
                  items={[
                    {
                      id: 'booksy',
                      icon: BooksyIcon,
                      title: 'Booksy',
                      benefit:
                        'Импортируем всех клиентов, мастеров и историю визитов — финансы сразу видны.',
                      status: 'available',
                    },
                    {
                      id: 'fresha',
                      icon: FreshaIcon,
                      title: 'Fresha',
                      benefit:
                        'Глобальная платформа бронирования (UK / EU / US). Бесплатная для салонов.',
                      status: 'coming_soon',
                    },
                    {
                      id: 'treatwell',
                      icon: TreatwellIcon,
                      title: 'Treatwell',
                      benefit: 'Британская и европейская marketplace бронирования салонов красоты.',
                      status: 'coming_soon',
                    },
                    {
                      id: 'yclients',
                      icon: YclientsIcon,
                      title: 'YCLIENTS',
                      benefit:
                        'Популярная платформа в Украине, России и Казахстане. CRM + онлайн-запись.',
                      status: 'coming_soon',
                    },
                  ]}
                />
              ) : (
                <IntegrationCategoryStep
                  title={t('onboarding.step_integrations.bookings_title')}
                  items={[
                    {
                      id: 'booksy',
                      icon: BooksyIcon,
                      title: 'Booksy',
                      benefit:
                        'Импортируем всех клиентов, мастеров и историю визитов — финансы сразу видны.',
                    },
                  ]}
                  selected={state.selected_integrations}
                  onToggle={(id) =>
                    patch(
                      'selected_integrations',
                      state.selected_integrations.includes(id)
                        ? state.selected_integrations.filter((x) => x !== id)
                        : [...state.selected_integrations, id],
                    )
                  }
                  credentials={state.pending_credentials}
                  onCredentialsChange={(id, creds) =>
                    patch('pending_credentials', {
                      ...state.pending_credentials,
                      [id]: creds ?? {},
                    })
                  }
                />
              ))}
            {stepId === 'integrations_social' &&
              (state.created_salon_id ? (
                <LiveIntegrationCategoryStep
                  title={t('onboarding.step_integrations.social_title')}
                  salonId={state.created_salon_id}
                  items={[
                    {
                      id: 'instagram',
                      icon: InstagramIcon,
                      title: 'Instagram Direct',
                      benefit:
                        'Клиент пишет в Instagram — ты отвечаешь из портала. AI берёт типовые вопросы на себя.',
                    },
                    {
                      id: 'facebook',
                      icon: FacebookIcon,
                      title: 'Facebook Messenger',
                      benefit:
                        'Все сообщения от клиентов в одной ленте — без переключения вкладок.',
                    },
                    {
                      id: 'telegram',
                      icon: TelegramIcon,
                      title: 'Telegram',
                      benefit:
                        'Подключаем твой личный Telegram через MTProto — отвечаешь клиентам прямо из портала.',
                    },
                  ]}
                />
              ) : (
                <IntegrationCategoryStep
                  title={t('onboarding.step_integrations.social_title')}
                  items={[
                    {
                      id: 'instagram',
                      icon: InstagramIcon,
                      title: 'Instagram Direct',
                      benefit:
                        'Клиент пишет в Instagram — ты отвечаешь из портала. AI берёт типовые вопросы на себя.',
                    },
                    {
                      id: 'facebook',
                      icon: FacebookIcon,
                      title: 'Facebook Messenger',
                      benefit:
                        'Все сообщения от клиентов в одной ленте — без переключения вкладок.',
                    },
                    {
                      id: 'telegram',
                      icon: TelegramIcon,
                      title: 'Telegram',
                      benefit:
                        'Подключаем твой личный Telegram через MTProto — отвечаешь клиентам прямо из портала.',
                    },
                  ]}
                  selected={state.selected_integrations}
                  onToggle={(id) =>
                    patch(
                      'selected_integrations',
                      state.selected_integrations.includes(id)
                        ? state.selected_integrations.filter((x) => x !== id)
                        : [...state.selected_integrations, id],
                    )
                  }
                  credentials={state.pending_credentials}
                  onCredentialsChange={(id, creds) =>
                    patch('pending_credentials', {
                      ...state.pending_credentials,
                      [id]: creds ?? {},
                    })
                  }
                />
              ))}
            {stepId === 'wow' && (
              <StepWowAi
                hasBookings={state.selected_integrations.some((x) =>
                  ['booksy', 'ical', 'ocr_notebook'].includes(x),
                )}
                hasBanking={state.selected_integrations.includes('banking')}
                hasSocial={state.selected_integrations.some((x) =>
                  ['instagram', 'facebook', 'telegram'].includes(x),
                )}
                full={state.path === 'full'}
                selectedIntegrations={state.selected_integrations}
                staffCount={state.staff.length}
                servicesCount={state.services.length}
                hasGooglePlace={!!state.address.google_place_id}
                hasNip={!!state.nip}
                companyName={state.company_name}
                ocrVisitsCount={state.ocr_visits.length}
                salonType={state.salon_type}
                country={state.country_code}
                salonId={state.created_salon_id}
              />
            )}
            {stepId === 'ai_services' && (
              <StepAiBreakdown topic="services" salonId={state.created_salon_id} />
            )}
            {stepId === 'ai_staff' && (
              <StepAiBreakdown topic="staff" salonId={state.created_salon_id} />
            )}
            {stepId === 'ai_clients' && (
              <StepAiBreakdown topic="clients" salonId={state.created_salon_id} />
            )}
            {stepId === 'ai_reviews' && (
              <StepAiBreakdown topic="reviews" salonId={state.created_salon_id} />
            )}
            {stepId === 'ai_summary' && (
              <StepAiSummary
                salonType={state.salon_type}
                country={state.country_code}
                selectedIntegrations={state.selected_integrations}
                staffCount={state.staff.length}
                servicesCount={state.services.length}
                hasGooglePlace={!!state.address.google_place_id}
                hasNip={!!state.nip}
                companyName={state.company_name}
                ocrVisitsCount={state.ocr_visits.length}
                salonId={state.created_salon_id}
              />
            )}
            {stepId === 'public_links' && (
              <StepPublicLinks
                value={{
                  booksy_url: state.booksy_url,
                  instagram_url: state.instagram_url,
                  facebook_url: state.facebook_url,
                }}
                onChange={(v) => setState((prev) => ({ ...prev, ...v }))}
              />
            )}
            {stepId === 'integrations_banking' &&
              (state.created_salon_id ? (
                <LiveIntegrationCategoryStep
                  title={t('onboarding.step_integrations.banking_title')}
                  salonId={state.created_salon_id}
                  items={[
                    {
                      id: 'banking',
                      icon: BankingIcon,
                      title: 'Банковский счёт (PSD2)',
                      benefit:
                        'Каждое списание автоматом упадёт в Расходы. Можешь подключить несколько банков сразу.',
                    },
                  ]}
                />
              ) : (
                <IntegrationCategoryStep
                  title={t('onboarding.step_integrations.banking_title')}
                  items={[
                    {
                      id: 'banking',
                      icon: BankingIcon,
                      title: 'Банковский счёт (PSD2)',
                      benefit:
                        'Каждое списание автоматом упадёт в Расходы. Можешь подключить несколько банков сразу.',
                    },
                  ]}
                  selected={state.selected_integrations}
                  onToggle={(id) =>
                    patch(
                      'selected_integrations',
                      state.selected_integrations.includes(id)
                        ? state.selected_integrations.filter((x) => x !== id)
                        : [...state.selected_integrations, id],
                    )
                  }
                  credentials={state.pending_credentials}
                  onCredentialsChange={(id, creds) =>
                    patch('pending_credentials', {
                      ...state.pending_credentials,
                      [id]: creds ?? {},
                    })
                  }
                />
              ))}
            {stepId === 'staff' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.staff')}</TutorialNote>
                {state.created_salon_id ? (
                  <Step2StaffLive salonId={state.created_salon_id} />
                ) : (
                  <Step2Staff value={state.staff} onChange={(v) => patch('staff', v)} />
                )}
              </>
            )}
            {stepId === 'services' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.services')}</TutorialNote>
                {state.created_salon_id ? (
                  <Step3ServicesLive salonId={state.created_salon_id} />
                ) : (
                  <Step3Services
                    value={state.services}
                    onChange={(v) => patch('services', v)}
                    salonType={state.salon_type}
                  />
                )}
              </>
            )}
            {stepId === 'expenses' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.expenses')}</TutorialNote>
                <Step4Expenses
                  value={state.expense_categories}
                  onChange={(v) => patch('expense_categories', v)}
                  financial={state.financial_settings}
                  onFinancialChange={(v) => patch('financial_settings', v)}
                />
              </>
            )}
            {stepId === 'done' && (
              <Step5Done
                summary={{ salonName: state.name }}
                benchmarksOptIn={state.benchmarks_opt_in}
                onBenchmarksToggle={(v) => patch('benchmarks_opt_in', v)}
                subscribeAfterSubmit={state.subscribe_after_submit}
                onSubscribeToggle={(v) => patch('subscribe_after_submit', v)}
                path={state.path}
                onSwitchToFull={() => {
                  patch('path', 'full')
                  const fullIndex = (STEPS_FULL as readonly string[]).indexOf('schedule')
                  if (fullIndex >= 0) setStepIndex(fullIndex)
                }}
              />
            )}
          </div>

          {submitError ? (
            <p className="text-destructive mt-6 text-sm font-medium" role="alert">
              {submitError}
            </p>
          ) : null}

          {/* Footer actions */}
          <div className="border-border mt-8 flex items-center justify-between border-t pt-6">
            <button
              type="button"
              onClick={back}
              disabled={isFirst}
              className="text-muted-foreground hover:text-foreground text-sm font-medium disabled:cursor-not-allowed disabled:opacity-30"
              data-testid="onboarding-back"
            >
              ← {t('common.back')}
            </button>
            <div className="flex items-center gap-5">
              {!isLast && stepId !== 'salon' ? (
                <button
                  type="button"
                  onClick={skip}
                  className="text-muted-foreground hover:text-foreground text-sm font-medium"
                  data-testid="onboarding-skip"
                >
                  {t('onboarding.skip')}
                </button>
              ) : null}
              {isLast ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={submit}
                  disabled={submitting}
                  data-testid="onboarding-submit"
                >
                  {submitting
                    ? t('common.loading')
                    : state.subscribe_after_submit
                      ? t('onboarding.activate_subscription')
                      : t('onboarding.open_dashboard')}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  onClick={next}
                  disabled={!canProceed()}
                  data-testid="onboarding-next"
                >
                  {nextCtaLabel()}
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
