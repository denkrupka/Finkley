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
import { Step1Salon } from './Step1Salon'
import { Step2Staff, type StaffDraft } from './Step2Staff'
import { Step3Services, type ServiceDraft } from './Step3Services'
import { Step4Expenses } from './Step4Expenses'
import { Step5Done } from './Step5Done'

const STEPS = ['salon', 'staff', 'services', 'expenses', 'done'] as const
type StepId = (typeof STEPS)[number]

export type OnboardingState = {
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
}

const INITIAL: OnboardingState = {
  name: '',
  country_code: 'PL',
  salon_type: 'hair',
  staff: [],
  services: [],
  expense_categories: [...DEFAULT_EXPENSE_CATEGORIES],
}

export function OnboardingPage() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [stepIndex, setStepIndex] = useState(0)
  const [state, setState] = useState<OnboardingState>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const stepId: StepId = STEPS[stepIndex]!
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
    rememberLastSalon(newSalonId)
    // Кэш `useMySalons` не знает о только что созданном салоне.
    // invalidateQueries сам по себе не блокирующий — SalonLayout мог бы
    // отрендериться раньше и редиректнуть «нет салона» → /. Поэтому
    // awaiting refetch прямо здесь, до navigate.
    await queryClient.refetchQueries({ queryKey: ['salons'] })
    // Welcome-письмо в фоне — не блокирует navigate, ошибка email не должна
    // ломать UX онбординга (Postmark может тупить, sender signature пропасть).
    void triggerWelcomeEmail(newSalonId, state.name.trim())
    navigate(`/${newSalonId}/dashboard`, { replace: true })
  }

  async function triggerWelcomeEmail(salonId: string, salonName: string) {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      await fetch(`${SUPABASE_URL}/functions/v1/notify-welcome`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ salon_id: salonId, salon_name: salonName }),
      })
    } catch (err) {
      console.warn('welcome email trigger failed', err)
    }
  }

  // Валидация перехода. Step5 — терминальный, переход = submit.
  function canProceed(): boolean {
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
            {stepId === 'salon' && (
              <Step1Salon
                value={{
                  name: state.name,
                  country_code: state.country_code,
                  salon_type: state.salon_type,
                }}
                onChange={(v) => setState((prev) => ({ ...prev, ...v }))}
              />
            )}
            {stepId === 'staff' && (
              <Step2Staff value={state.staff} onChange={(v) => patch('staff', v)} />
            )}
            {stepId === 'services' && (
              <Step3Services
                value={state.services}
                onChange={(v) => patch('services', v)}
                salonType={state.salon_type}
              />
            )}
            {stepId === 'expenses' && (
              <Step4Expenses
                value={state.expense_categories}
                onChange={(v) => patch('expense_categories', v)}
              />
            )}
            {stepId === 'done' && (
              <Step5Done
                summary={{
                  salonName: state.name,
                  staffCount: state.staff.filter((s) => s.full_name.trim()).length,
                  servicesCount: state.services.filter((s) => s.name.trim()).length,
                  expensesCount: state.expense_categories.filter((c) => c.trim()).length,
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
