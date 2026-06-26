import {
  Banknote,
  Bot,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  FileBarChart,
  Gift,
  Globe,
  Instagram,
  Landmark,
  LineChart,
  Link2,
  Loader2,
  MessageCircle,
  Megaphone,
  Package,
  Plug,
  Receipt,
  Sparkles,
  Target,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { BrandIcon } from '@/routes/onboarding/BrandIcon'
import { useSalonMembership } from '@/hooks/useSalons'
import {
  readDismissedSteps,
  useClaimSetupReward,
  useSetupProgress,
  writeDismissedStep,
} from '@/hooks/useSetupProgress'
import {
  computePercent,
  computeSetupSteps,
  isRewardEligible,
  remainingSteps,
  rewardDaysLeft,
  shouldShowSetupBar,
  type SetupStep,
  type SetupStepId,
} from '@/lib/setup-progress'
import { cn } from '@/lib/utils/cn'

type CtaMap = Record<SetupStepId, () => void>

const ICONS: Record<SetupStepId, typeof CalendarPlus> = {
  // core
  visit: CalendarPlus,
  expense: Receipt,
  booksy: CalendarPlus, // переопределяется BrandIcon ниже
  bank: Banknote,
  dashboard: LineChart,
  // extra (v2)
  first_client_closed: UserCheck,
  expense_calculated: Wallet,
  scheduled_payment: CalendarClock,
  bank_synced: Landmark,
  bank_tx_linked: Link2,
  finance_report: FileBarChart,
  competitor: Target,
  social_page: Instagram,
  google_profile: Globe,
  inventory_item: Package,
  marketing_broadcast: Megaphone,
  messenger_message: MessageCircle,
  ai_assistant: Bot,
  booking: CalendarPlus,
  any_integration: Plug,
}

/**
 * «Настройка Finkley» — gamified бар прогресса первичной настройки (T2).
 *
 * Свёрнутый: висит сверху пока setup < 100%. Раскрытый: чек-лист карточек
 * (что/зачем/что даст/CTA) + приз «+14 дней» за 100% в течение 7 дней.
 * Прогресс считается на сервере (RPC setup_progress) из реальных событий.
 */
export function SetupProgressBar({
  salonId,
  onAddVisit,
  onAddExpense,
}: {
  salonId: string
  onAddVisit: () => void
  onAddExpense: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: progress } = useSetupProgress(salonId)
  const { data: membership } = useSalonMembership(salonId)
  const claim = useClaimSetupReward(salonId)
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState<Set<SetupStepId>>(() => readDismissedSteps(salonId))

  // При смене салона перечитываем пропуски.
  useEffect(() => {
    setDismissed(readDismissedSteps(salonId))
    setExpanded(false)
  }, [salonId])

  if (!progress) return null
  const steps = computeSetupSteps(progress, dismissed)
  if (!shouldShowSetupBar(progress, steps, membership?.role)) return null

  const percent = computePercent(steps)
  const remaining = remainingSteps(steps)
  const eligible = isRewardEligible(progress, steps)
  const daysLeft = rewardDaysLeft(progress.created_at)
  const coreSteps = steps.filter((s) => s.required)
  const extraSteps = steps.filter((s) => !s.required)

  function toggleDismiss(step: SetupStepId) {
    setDismissed((prev) => {
      const next = new Set(prev)
      const willDismiss = !next.has(step)
      if (willDismiss) next.add(step)
      else next.delete(step)
      writeDismissedStep(salonId, step, willDismiss)
      return next
    })
  }

  const go = (to: string) => () => {
    setExpanded(false)
    navigate(to)
  }

  const cta: CtaMap = {
    // core
    visit: () => {
      setExpanded(false)
      onAddVisit()
    },
    expense: () => {
      setExpanded(false)
      onAddExpense()
    },
    booksy: () => navigate(`/${salonId}/settings?tab=integrations&prompt=booksy`),
    bank: () => navigate(`/${salonId}/settings?tab=integrations&prompt=banking`),
    dashboard: go(`/${salonId}/dashboard`),
    // extra (v2)
    first_client_closed: go(`/${salonId}/income?tab=visits`),
    expense_calculated: go(`/${salonId}/payouts`),
    scheduled_payment: go(`/${salonId}/finance?tab=payments`),
    bank_synced: () => navigate(`/${salonId}/settings?tab=integrations&prompt=banking`),
    bank_tx_linked: go(`/${salonId}/finance?tab=cash`),
    finance_report: go(`/${salonId}/finance?tab=report`),
    competitor: go(`/${salonId}/reports?tab=competitors`),
    social_page: go(`/${salonId}/settings?tab=profile`),
    google_profile: go(`/${salonId}/settings?tab=profile`),
    inventory_item: go(`/${salonId}/inventory`),
    marketing_broadcast: go(`/${salonId}/marketing`),
    messenger_message: go(`/${salonId}/messenger`),
    ai_assistant: go(`/${salonId}/ai`),
    booking: () => navigate(`/${salonId}/settings?tab=integrations`),
    any_integration: () => navigate(`/${salonId}/settings?tab=integrations`),
  }

  function handleClaim() {
    claim.mutate(undefined, {
      onSuccess: (res) => {
        if (res.granted) {
          toast.success(
            t('setup_progress.reward.claimed', {
              days: res.bonus_days ?? 14,
              defaultValue: '🎁 +{{days}} дней демо добавлено! Спасибо, что настроили Finkley.',
            }),
          )
          setExpanded(false)
        } else {
          toast.message(
            t(`setup_progress.reward.reason.${res.reason ?? 'unknown'}`, {
              defaultValue: t('setup_progress.reward.reason.unknown', {
                defaultValue: 'Награда пока недоступна.',
              }),
            }),
          )
        }
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    })
  }

  return (
    <div className="relative z-20">
      {/* Свёрнутый бар */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="border-brand-teal-deep/20 bg-brand-teal-soft/25 hover:bg-brand-teal-soft/40 flex w-full items-center gap-3 border-b px-4 py-2.5 text-left transition-colors sm:px-6"
        aria-expanded={expanded}
      >
        <Sparkles className="text-brand-teal-deep size-4 shrink-0" strokeWidth={2.2} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-brand-navy text-sm font-bold">
              {t('setup_progress.title', { defaultValue: 'Настройка Finkley' })}
            </span>
            <span className="num text-brand-teal-deep text-sm font-extrabold">{percent}%</span>
            <span className="text-muted-foreground hidden truncate text-xs sm:inline">
              ·{' '}
              {eligible
                ? t('setup_progress.collapsed_reward_ready', {
                    defaultValue: 'всё готово — заберите +14 дней 🎁',
                  })
                : t('setup_progress.remaining', {
                    count: remaining,
                    defaultValue: 'ещё {{count}} шагов до полной картины прибыли',
                  })}
            </span>
          </div>
          {/* Прогресс-полоска */}
          <div className="bg-brand-teal-soft/50 mt-1.5 h-[5px] w-full overflow-hidden rounded-full">
            <div
              className="bg-brand-teal-deep h-full rounded-full transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <ChevronDown
          className={cn(
            'text-brand-teal-deep size-4 shrink-0 transition-transform',
            expanded && 'rotate-180',
          )}
          strokeWidth={2.2}
        />
      </button>

      {/* Раскрытый чек-лист (dropdown) */}
      {expanded ? (
        <>
          <button
            type="button"
            aria-label={t('common.close', { defaultValue: 'Закрыть' })}
            onClick={() => setExpanded(false)}
            className="fixed inset-0 z-10 cursor-default bg-black/20"
          />
          <div className="border-border bg-card shadow-finlg absolute left-0 right-0 top-full z-20 max-h-[80vh] overflow-y-auto border-b px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="text-brand-navy text-sm font-bold leading-snug">
                  {t('setup_progress.expanded_header', {
                    defaultValue:
                      'Закончите настройку — и Finkley покажет реальную прибыль салона, а не просто оборот.',
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="text-muted-foreground hover:text-foreground -mr-1 grid size-7 shrink-0 place-items-center rounded-md"
                  aria-label={t('common.close', { defaultValue: 'Закрыть' })}
                >
                  <X className="size-4" strokeWidth={2} />
                </button>
              </div>

              {/* Плашка приза */}
              <div
                className={cn(
                  'mb-4 flex items-center gap-3 rounded-lg border-2 border-dashed p-3',
                  eligible
                    ? 'border-brand-gold-deep bg-brand-gold-soft/30'
                    : 'border-brand-teal-deep/30 bg-brand-teal-soft/15',
                )}
              >
                <Gift
                  className={cn(
                    'size-5 shrink-0',
                    eligible ? 'text-brand-gold-deep' : 'text-brand-teal-deep',
                  )}
                  strokeWidth={2}
                />
                <p className="text-foreground/90 min-w-0 flex-1 text-xs leading-snug">
                  {eligible
                    ? t('setup_progress.reward.ready', {
                        defaultValue: 'Всё готово! Заберите подарок — 14 дополнительных дней демо.',
                      })
                    : t('setup_progress.reward.promise', {
                        days: daysLeft,
                        defaultValue:
                          'Выполните все задания на 100% за {{days}} дн. — и получите +14 дней демо в подарок.',
                      })}
                </p>
                {eligible ? (
                  <button
                    type="button"
                    onClick={handleClaim}
                    disabled={claim.isPending}
                    className="bg-brand-gold-deep inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {claim.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" strokeWidth={2.5} />
                    ) : (
                      <Gift className="size-3.5" strokeWidth={2.2} />
                    )}
                    {t('setup_progress.reward.claim_button', { defaultValue: 'Забрать +14 дней' })}
                  </button>
                ) : null}
              </div>

              {/* Карточки шагов: сначала ключевые (влияют на %/приз),
                  затем «полная картина» (трекинг полноты, на приз не влияют). */}
              <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-wide">
                {t('setup_progress.section.core', { defaultValue: 'Главное' })}
              </p>
              <div className="flex flex-col gap-2">
                {coreSteps.map((step) => (
                  <SetupCard
                    key={step.id}
                    step={step}
                    onCta={cta[step.id]}
                    onDismiss={() => toggleDismiss(step.id)}
                    t={t}
                  />
                ))}
              </div>

              {extraSteps.length > 0 ? (
                <>
                  <p className="text-muted-foreground mb-2 mt-4 text-[11px] font-bold uppercase tracking-wide">
                    {t('setup_progress.section.extra', {
                      defaultValue: 'Полная картина салона',
                    })}
                  </p>
                  <div className="flex flex-col gap-2">
                    {extraSteps.map((step) => (
                      <SetupCard
                        key={step.id}
                        step={step}
                        onCta={cta[step.id]}
                        onDismiss={() => toggleDismiss(step.id)}
                        t={t}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function SetupCard({
  step,
  onCta,
  onDismiss,
  t,
}: {
  step: SetupStep
  onCta: () => void
  onDismiss: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const Icon = ICONS[step.id]
  const done = step.done
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
        done ? 'border-brand-sage/40 bg-brand-sage-soft/20' : 'border-border bg-card',
      )}
    >
      <div
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          done ? 'bg-brand-sage text-white' : 'bg-brand-teal-soft/40 text-brand-teal-deep',
        )}
      >
        {done ? (
          <Check className="size-4" strokeWidth={2.6} />
        ) : step.id === 'booksy' ? (
          <BrandIcon provider="booksy" className="size-4" />
        ) : (
          <Icon className="size-4" strokeWidth={2} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-bold',
            done ? 'text-brand-sage-deep line-through' : 'text-brand-navy',
          )}
        >
          {t(`setup_progress.cards.${step.id}.title`)}
        </p>
        {!done ? (
          <>
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
              <span className="font-semibold">
                {t('setup_progress.why_label', { defaultValue: 'Зачем' })}:
              </span>{' '}
              {t(`setup_progress.cards.${step.id}.why`)}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
              <span className="font-semibold">
                {t('setup_progress.gives_label', { defaultValue: 'Что даст' })}:
              </span>{' '}
              {t(`setup_progress.cards.${step.id}.gives`)}
            </p>
          </>
        ) : (
          <p className="text-brand-sage-deep mt-0.5 text-xs">
            {step.dismissed
              ? t('setup_progress.skipped', { defaultValue: 'Пропущено' })
              : t('setup_progress.done', { defaultValue: 'Готово' })}
          </p>
        )}
      </div>
      {!done ? (
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onCta}
            className="bg-brand-navy hover:bg-brand-navy/90 inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold text-white transition-colors"
          >
            {t(`setup_progress.cards.${step.id}.cta`)}
          </button>
          {step.dismissable ? (
            <button
              type="button"
              onClick={onDismiss}
              className="text-muted-foreground hover:text-foreground text-[11px] font-medium underline-offset-2 hover:underline"
            >
              {t(`setup_progress.cards.${step.id}.skip`, {
                defaultValue: t('setup_progress.skip', { defaultValue: 'Пропустить' }),
              })}
            </button>
          ) : null}
        </div>
      ) : step.dismissed ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground shrink-0 text-[11px] font-medium underline-offset-2 hover:underline"
        >
          {t('setup_progress.undo_skip', { defaultValue: 'Вернуть' })}
        </button>
      ) : null}
    </div>
  )
}
