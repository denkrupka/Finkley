import { useQueryClient } from '@tanstack/react-query'
import { Plug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

// Универсальная иконка-заглушка для категорий интеграций. Разные провайдеры
// отображаются одним стилем; различие — в title.
const PlugIconSvg = Plug

import { Button } from '@/components/ui/button'
import { LogoLockup } from '@/components/ui/logo'
import { useAuth } from '@/hooks/useAuth'
import { DEFAULT_FINANCIAL_SETTINGS, type FinancialSettings } from '@/hooks/useFinancialSettings'
import { detectCountryByIp } from '@/lib/detect-country'
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
import { OcrNotebookButton, type ParsedVisit } from './OcrNotebookButton'
import { StepAiBreakdown } from './StepAiBreakdown'
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
import { Step3Accounting } from './Step3Accounting'
import { Step3Services, type ServiceDraft } from './Step3Services'
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
  'done',
] as const
type StepId = (typeof STEPS_FULL)[number] | (typeof STEPS_QUICK)[number]

export type OnboardingIntegration =
  | 'booksy'
  | 'wfirma'
  | 'banking'
  | 'instagram'
  | 'facebook'
  | 'telegram'
  | 'ical'
  | 'ocr_notebook'
  // T107 — бухгалтерия
  | 'ksef'
  | 'fakturownia'
  | 'ifirma'
  | 'infakt'

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
}

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
  // bug ee00e1a7 — отключаем требование привязки карты в первых шагах.
  // Юзер хочет полностью бесшовный trial: попадает в /dashboard сразу,
  // без редиректа в Stripe Checkout. Активация подписки переехала в
  // /settings/billing где юзер увидит CTA «Активировать».
  subscribe_after_submit: false,
}

export function OnboardingPage() {
  const { t, i18n } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [stepIndex, setStepIndex] = useState(0)
  const [state, setState] = useState<OnboardingState>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // IP-based auto-detect страны. Запускается один раз при монтировании;
  // не блокирующий. Если юзер уже что-то выбрал (или поменял страну руками
  // в Step1Salon после монтирования) — не перезаписываем.
  useEffect(() => {
    let cancelled = false
    detectCountryByIp().then((cc) => {
      if (cancelled || !cc) return
      setState((prev) => (prev.country_code === 'PL' ? { ...prev, country_code: cc } : prev))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // STEPS зависят от выбранного пути: пока не выбран — только path-шаг.
  const STEPS: readonly StepId[] = state.path === 'full' ? STEPS_FULL : STEPS_QUICK
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

  function next() {
    if (stepIndex === 1) {
      // переход 2→3 — заполнить services seed по выбранному типу
      patch('services', ensureServicesSeed(state.salon_type, state.services))
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
    setSubmitting(false)

    if (error) {
      setSubmitError(error.message)
      return
    }
    const newSalonId = data as unknown as string
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

    if (Object.keys(extraPatch).length > 0) {
      await supabase.from('salons').update(extraPatch).eq('id', newSalonId)
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

    // Paywall: если юзер не снял чек-бокс «активировать trial» — редиректим
    // в Stripe Checkout (мode=subscription, trialDays=14). Стандартный
    // success_url возвращает на settings?stripe=success → дальше dashboard.
    if (state.subscribe_after_submit) {
      try {
        const { data: checkoutData, error: checkoutErr } = await supabase.functions.invoke(
          'create-checkout-session',
          { body: { salonId: newSalonId } },
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
        return t('onboarding.cta.welcome', { defaultValue: 'Начать зарабатывать больше →' })
      case 'path':
        return t('onboarding.cta.path', { defaultValue: 'Поехали →' })
      case 'salon':
        return t('onboarding.cta.salon', { defaultValue: 'Создать профиль салона →' })
      case 'address':
        return t('onboarding.cta.address', { defaultValue: 'Сохранить адрес →' })
      case 'accounting':
        return t('onboarding.cta.accounting', { defaultValue: 'Готово, дальше →' })
      case 'integrations_bookings':
        return t('onboarding.cta.integrations_bookings', {
          defaultValue: 'Освободить от ручного ввода визитов →',
        })
      case 'integrations_social':
        return t('onboarding.cta.integrations_social', {
          defaultValue: 'Свести все сообщения в одну ленту →',
        })
      case 'integrations_banking':
        return t('onboarding.cta.integrations_banking', {
          defaultValue: 'Включить авто-учёт расходов →',
        })
      case 'wow':
        return t('onboarding.cta.wow', { defaultValue: 'Перейти к моему порталу →' })
      case 'profile':
        return t('onboarding.cta.profile', { defaultValue: 'Готово, поехали →' })
      case 'tg_phone':
        return t('onboarding.cta.tg_phone', { defaultValue: 'Сохранить и дальше →' })
      case 'schedule':
        return t('onboarding.cta.schedule', { defaultValue: 'Сохранить график →' })
      case 'public_links':
        return t('onboarding.cta.public_links', { defaultValue: 'Сохранить ссылки →' })
      case 'ai_services':
        return t('onboarding.cta.ai_services', { defaultValue: 'Перейти к мастерам →' })
      case 'ai_staff':
        return t('onboarding.cta.ai_staff', { defaultValue: 'Перейти к клиентам →' })
      case 'ai_clients':
        return t('onboarding.cta.ai_clients', { defaultValue: 'Перейти к отзывам →' })
      case 'ai_reviews':
        return t('onboarding.cta.ai_reviews', { defaultValue: 'Готово, к моему порталу →' })
      case 'staff':
        return t('onboarding.cta.staff', { defaultValue: 'Подключить команду →' })
      case 'services':
        return t('onboarding.cta.services', { defaultValue: 'Готово, к расходам →' })
      case 'expenses':
        return t('onboarding.cta.expenses', { defaultValue: 'Увидеть реальную прибыль →' })
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
            <div className="flex gap-2">
              {STEPS.map((s, i) => {
                const active = i === stepIndex
                const done = i < stepIndex
                return (
                  <div key={s} className="flex-1">
                    <div
                      className={cn(
                        'mb-2 h-[5px] rounded-full',
                        done || active ? 'bg-primary' : 'bg-border',
                      )}
                    />
                    <div
                      className={cn(
                        'text-[11.5px]',
                        active
                          ? 'text-brand-navy font-bold'
                          : done
                            ? 'text-foreground font-medium'
                            : 'text-brand-text-faint font-medium',
                      )}
                    >
                      {t(`onboarding.steps.${s}`)}
                    </div>
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
                <TutorialNote>{t('onboarding.tutorial.salon')}</TutorialNote>
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
            {stepId === 'address' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.address')}</TutorialNote>
                <Step2Address value={state.address} onChange={(v) => patch('address', v)} />
              </>
            )}
            {stepId === 'accounting' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.accounting')}</TutorialNote>
                <Step3Accounting
                  value={{ nip: state.nip, company_name: state.company_name }}
                  onChange={(v) =>
                    setState((prev) => ({ ...prev, nip: v.nip, company_name: v.company_name }))
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
                />
              </>
            )}
            {stepId === 'integrations_bookings' && (
              <IntegrationCategoryStep
                title={t('onboarding.step_integrations.bookings_title', {
                  defaultValue: 'Запись и календари',
                })}
                subtitle={t('onboarding.step_integrations.bookings_subtitle', {
                  defaultValue:
                    'Перестань вручную переписывать визиты — мы синхронизируем их сразу из Booksy или импортируем фото блокнота через AI.',
                })}
                emoji="📅"
                extra={
                  <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 rounded-lg border-2 border-dashed p-3.5">
                    <p className="text-foreground mb-2 text-xs font-bold uppercase tracking-wider">
                      {t('onboarding.ocr.section_title', {
                        defaultValue: '📓 Или прямо сейчас — сфотографируй блокнот',
                      })}
                    </p>
                    <p className="text-muted-foreground mb-3 text-xs leading-snug">
                      {t('onboarding.ocr.section_body', {
                        defaultValue:
                          'AI распознаёт рукописные записи. Покажет тебе таблицу — отметишь какие визиты импортировать. Доступно сразу после создания салона на этом же шаге.',
                      })}
                    </p>
                    <OcrNotebookButton
                      salonId={null}
                      onVisitsParsed={(v) => patch('ocr_visits', [...state.ocr_visits, ...v])}
                    />
                    {state.ocr_visits.length > 0 ? (
                      <p className="text-brand-teal-deep mt-2 text-xs font-bold">
                        ✓{' '}
                        {t('onboarding.ocr.collected', {
                          defaultValue: 'В очереди на импорт: {{count}} визитов',
                          count: state.ocr_visits.length,
                        })}
                      </p>
                    ) : null}
                  </div>
                }
                items={[
                  {
                    id: 'booksy',
                    icon: PlugIconSvg,
                    title: 'Booksy',
                    benefit:
                      'Все визиты, мастера и клиенты автоматом подтянутся в портал. Дальше — финансы считаются сами.',
                  },
                  {
                    id: 'ical',
                    icon: PlugIconSvg,
                    title: 'iCal-фид (Google / Apple / Outlook)',
                    benefit:
                      'Каждый мастер подпишется на свой календарь визитов и увидит их в любом телефоне.',
                  },
                  {
                    id: 'ocr_notebook',
                    icon: PlugIconSvg,
                    title: 'Фото блокнота → AI разнесёт по визитам',
                    benefit:
                      'Сфотографируй заметки/блокнот — AI распознает дату, клиента и сумму. Никакого ручного ввода.',
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
              />
            )}
            {stepId === 'integrations_social' && (
              <IntegrationCategoryStep
                title={t('onboarding.step_integrations.social_title', {
                  defaultValue: 'Соцсети и мессенджеры',
                })}
                subtitle={t('onboarding.step_integrations.social_subtitle', {
                  defaultValue:
                    'Все сообщения от клиентов — в одну ленту. Никаких «пропустила, потеряла визит». Плюс AI отвечает за тебя на типовые вопросы.',
                })}
                emoji="💬"
                items={[
                  {
                    id: 'instagram',
                    icon: PlugIconSvg,
                    title: 'Instagram Direct',
                    benefit:
                      'DM-ы клиентов попадают в портал. AI отвечает на цены/расписание автоматом.',
                  },
                  {
                    id: 'facebook',
                    icon: PlugIconSvg,
                    title: 'Facebook Messenger',
                    benefit: 'Тот же inbox — клиент пишет, ты отвечаешь из одного места.',
                  },
                  {
                    id: 'telegram',
                    icon: PlugIconSvg,
                    title: 'Telegram',
                    benefit:
                      'Подключи свой канал/бота — получай дайджесты и AI-инсайты прямо в Telegram.',
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
              />
            )}
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
              />
            )}
            {stepId === 'ai_services' && <StepAiBreakdown topic="services" />}
            {stepId === 'ai_staff' && <StepAiBreakdown topic="staff" />}
            {stepId === 'ai_clients' && <StepAiBreakdown topic="clients" />}
            {stepId === 'ai_reviews' && <StepAiBreakdown topic="reviews" />}
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
            {stepId === 'integrations_banking' && (
              <IntegrationCategoryStep
                title={t('onboarding.step_integrations.banking_title', {
                  defaultValue: 'Банк и расходы',
                })}
                subtitle={t('onboarding.step_integrations.banking_subtitle', {
                  defaultValue:
                    'Каждое списание автоматом упадёт в раздел «Расходы». Никаких забытых трат — финансовая картина всегда живая.',
                })}
                emoji="🏦"
                items={[
                  {
                    id: 'banking',
                    icon: PlugIconSvg,
                    title: 'Banking (PSD2 — Enable Banking)',
                    benefit:
                      'Подключим твой банковский счёт через стандарт PSD2. Безопасно (мы видим только чтение), 90 дней без переподключения.',
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
              />
            )}
            {stepId === 'staff' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.staff')}</TutorialNote>
                <Step2Staff value={state.staff} onChange={(v) => patch('staff', v)} />
              </>
            )}
            {stepId === 'services' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.services')}</TutorialNote>
                <Step3Services
                  value={state.services}
                  onChange={(v) => patch('services', v)}
                  salonType={state.salon_type}
                />
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
              <>
                <TutorialNote>{t('onboarding.tutorial.done')}</TutorialNote>
                <Step5Done
                  summary={{
                    salonName: state.name,
                    staffCount: state.staff.filter((s) => s.full_name.trim()).length,
                    servicesCount: state.services.filter((s) => s.name.trim()).length,
                    expensesCount: state.expense_categories.filter((c) => c.trim()).length,
                  }}
                  benchmarksOptIn={state.benchmarks_opt_in}
                  onBenchmarksToggle={(v) => patch('benchmarks_opt_in', v)}
                  selectedIntegrations={state.selected_integrations}
                  onIntegrationsToggle={(v) => patch('selected_integrations', v)}
                  subscribeAfterSubmit={state.subscribe_after_submit}
                  onSubscribeToggle={(v) => patch('subscribe_after_submit', v)}
                  path={state.path}
                  onSwitchToFull={() => {
                    // T105 — переключаемся на full ветку и навигируем на
                    // первый «новый» шаг (schedule) — он отсутствовал в
                    // quick. Welcome/path/profile/salon/интеграции/tg_phone
                    // уже сделаны, повторять не нужно.
                    patch('path', 'full')
                    const fullIndex = (STEPS_FULL as readonly string[]).indexOf('schedule')
                    if (fullIndex >= 0) setStepIndex(fullIndex)
                  }}
                />
              </>
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
