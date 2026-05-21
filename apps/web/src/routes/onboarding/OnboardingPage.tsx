import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { LogoLockup } from '@/components/ui/logo'
import { useAuth } from '@/hooks/useAuth'
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
import { Step0Path, type OnboardingPath } from './Step0Path'
import { Step1Salon } from './Step1Salon'
import { Step2Staff, type StaffDraft } from './Step2Staff'
import { Step3Services, type ServiceDraft } from './Step3Services'
import { Step4Expenses } from './Step4Expenses'
import { Step5Done } from './Step5Done'
import { TutorialNote } from './TutorialNote'

const STEPS_QUICK = ['path', 'salon', 'done'] as const
const STEPS_FULL = ['path', 'salon', 'staff', 'services', 'expenses', 'done'] as const
type StepId = (typeof STEPS_FULL)[number]

export type OnboardingIntegration = 'booksy' | 'wfirma' | 'banking'

export type OnboardingState = {
  // Шаг 0 — путь (быстрый/полный). null = ещё не выбран.
  path: OnboardingPath | null
  // Шаг 1
  name: string
  country_code: CountryCode
  salon_type: SalonTypeId
  // Шаг 2
  staff: StaffDraft[]
  // Шаг 3
  services: ServiceDraft[]
  // Шаг 4
  expense_categories: string[]
  // Шаг 5
  benchmarks_opt_in: boolean
  selected_integrations: OnboardingIntegration[]
}

const INITIAL: OnboardingState = {
  path: null,
  name: '',
  country_code: 'PL',
  salon_type: 'hair',
  staff: [],
  services: [],
  expense_categories: [...DEFAULT_EXPENSE_CATEGORIES],
  benchmarks_opt_in: true, // дефолт ON — большинство соглашается, можно выключить
  selected_integrations: [],
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
    // Если юзер снял галочку «сравнение с рынком» — обновляем (default=true).
    if (!state.benchmarks_opt_in) {
      await supabase.from('salons').update({ benchmarks_opt_in: false }).eq('id', newSalonId)
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
            {stepId === 'path' && (
              <Step0Path value={state.path} onChange={(v) => patch('path', v)} />
            )}
            {stepId === 'salon' && (
              <>
                <TutorialNote>{t('onboarding.tutorial.salon')}</TutorialNote>
                <Step1Salon
                  value={{
                    name: state.name,
                    country_code: state.country_code,
                    salon_type: state.salon_type,
                  }}
                  onChange={(v) => setState((prev) => ({ ...prev, ...v }))}
                />
              </>
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
                  {submitting ? t('common.loading') : t('onboarding.open_dashboard')}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  onClick={next}
                  disabled={!canProceed()}
                  data-testid="onboarding-next"
                >
                  {t('common.next')} →
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
