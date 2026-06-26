import {
  Banknote,
  Bot,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
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
import { useEffect, useMemo, useState } from 'react'
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
  groupSetupSteps,
  isRewardEligible,
  remainingSteps,
  rewardDaysLeft,
  shouldShowSetupBar,
  type SetupGroupView,
  type SetupStep,
  type SetupStepGroup,
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

/** lucide-иконки категорий (заголовки аккордеона). */
const GROUP_ICONS: Record<SetupStepGroup, typeof CalendarPlus> = {
  income: CalendarPlus,
  expenses: Receipt,
  finance: LineChart,
  banking: Landmark,
  growth: Target,
  integrations: Plug,
}

/**
 * «Настройка Finkley» — gamified бар прогресса первичной настройки (T2 / v3).
 *
 * Свёрнутый: тонкая плашка сверху — прогресс + %, висит пока не все задания
 * (core + extra) выполнены или пропущены. Раскрытый: Stripe-style чек-лист по
 * раскрывающимся категориям (Доходы/Расходы/Финансы/Банк/Рост/Интеграции) +
 * плашка приза «+14 дней» (за CORE в течение 7 дней).
 *
 * Прогресс считается на сервере (RPC setup_progress) из реальных событий;
 * проценты/видимость/награда — в lib/setup-progress.ts (покрыто тестами).
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
  const [openGroups, setOpenGroups] = useState<Set<SetupStepGroup>>(() => new Set())
  const [dismissed, setDismissed] = useState<Set<SetupStepId>>(() => readDismissedSteps(salonId))

  // При смене салона перечитываем пропуски и сбрасываем UI-состояние.
  useEffect(() => {
    setDismissed(readDismissedSteps(salonId))
    setExpanded(false)
    setOpenGroups(new Set())
  }, [salonId])

  const steps = useMemo(
    () => (progress ? computeSetupSteps(progress, dismissed) : []),
    [progress, dismissed],
  )
  const groups = useMemo(() => groupSetupSteps(steps), [steps])

  // При первом раскрытии — авто-раскрыть первую незавершённую категорию,
  // чтобы юзер сразу видел, что делать (Stripe-паттерн).
  useEffect(() => {
    if (!expanded) return
    setOpenGroups((prev) => {
      if (prev.size > 0) return prev
      const firstIncomplete = groups.find((g) => !g.complete)
      return firstIncomplete ? new Set([firstIncomplete.group]) : prev
    })
  }, [expanded, groups])

  if (!progress) return null
  if (!shouldShowSetupBar(progress, steps, membership?.role)) return null

  const percent = computePercent(steps)
  const remaining = remainingSteps(steps)
  const eligible = isRewardEligible(progress, steps)
  const daysLeft = rewardDaysLeft(progress.created_at)

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

  function toggleGroup(group: SetupStepGroup) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
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

  // Текст подсказки: «всё готово» ТОЛЬКО когда реально не осталось заданий.
  // Если награда доступна (core готов), но extra-задания ещё есть — показываем
  // «осталось N · заберите +14 дней 🎁», а не ложное «всё готово».
  const collapsedHint =
    remaining === 0
      ? t('setup_progress.all_done', { defaultValue: 'всё готово 🎉' })
      : eligible
        ? t('setup_progress.tasks_left_reward', {
            count: remaining,
            defaultValue: 'осталось {{count}} · заберите +14 дней 🎁',
          })
        : t('setup_progress.tasks_left', {
            count: remaining,
            defaultValue: 'осталось {{count}} заданий',
          })

  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col">
      {/* Раскрытая панель — растёт ВВЕРХ над свёрнутым баром (Stripe-style) */}
      {expanded ? (
        <div className="border-border bg-card shadow-finlg mb-2 flex max-h-[68vh] flex-col overflow-hidden rounded-2xl border">
          {/* Шапка */}
          <div className="border-border flex items-start justify-between gap-2 border-b px-4 py-3">
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

          {/* Скролл-контент */}
          <div className="overflow-y-auto px-3 py-3">
            {/* Плашка приза «+14 дней» */}
            <div
              className={cn(
                'mb-3 flex items-center gap-3 rounded-lg border-2 border-dashed p-3',
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

            {/* Категории-аккордеоны */}
            <div className="flex flex-col gap-2">
              {groups.map((group) => (
                <SetupGroupSection
                  key={group.group}
                  group={group}
                  open={openGroups.has(group.group)}
                  onToggle={() => toggleGroup(group.group)}
                  cta={cta}
                  onDismiss={toggleDismiss}
                  t={t}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Свёрнутый бар — всегда виден, плавает справа снизу, выделяется */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'relative flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left shadow-xl transition-colors',
          eligible
            ? 'border-brand-gold-deep bg-brand-gold-soft/50 hover:bg-brand-gold-soft/70'
            : 'border-brand-teal-deep/50 bg-card hover:bg-brand-teal-soft/20',
        )}
        aria-expanded={expanded}
      >
        {/* Пульсирующая точка-нотификация — притягивает взгляд, пока есть задания */}
        {!expanded ? (
          <span className="absolute -right-1.5 -top-1.5 flex size-3.5">
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                eligible ? 'bg-brand-gold-deep' : 'bg-brand-teal-deep',
              )}
            />
            <span
              className={cn(
                'relative inline-flex size-3.5 rounded-full ring-2 ring-white',
                eligible ? 'bg-brand-gold-deep' : 'bg-brand-teal-deep',
              )}
            />
          </span>
        ) : null}
        <Sparkles
          className={cn(
            'size-5 shrink-0',
            eligible ? 'text-brand-gold-deep' : 'text-brand-teal-deep',
          )}
          strokeWidth={2.2}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-brand-navy text-sm font-bold">
              {t('setup_progress.title', { defaultValue: 'Настройка Finkley' })}
            </span>
            <span
              className={cn(
                'num text-sm font-extrabold',
                eligible ? 'text-brand-gold-deep' : 'text-brand-teal-deep',
              )}
            >
              {percent}%
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{collapsedHint}</p>
          {/* Прогресс-полоска */}
          <div
            className={cn(
              'mt-1.5 h-[5px] w-full overflow-hidden rounded-full',
              eligible ? 'bg-brand-gold-soft/60' : 'bg-brand-teal-soft/50',
            )}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                eligible ? 'bg-brand-gold-deep' : 'bg-brand-teal-deep',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform',
            eligible ? 'text-brand-gold-deep' : 'text-brand-teal-deep',
            expanded && 'rotate-180',
          )}
          strokeWidth={2.2}
        />
      </button>
    </div>
  )
}

function SetupGroupSection({
  group,
  open,
  onToggle,
  cta,
  onDismiss,
  t,
}: {
  group: SetupGroupView
  open: boolean
  onToggle: () => void
  cta: CtaMap
  onDismiss: (id: SetupStepId) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const GroupIcon = GROUP_ICONS[group.group]
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border transition-colors',
        group.complete ? 'border-brand-sage/40 bg-brand-sage-soft/15' : 'border-border bg-card',
      )}
    >
      {/* Заголовок категории */}
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
        aria-expanded={open}
      >
        <div
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg',
            group.complete
              ? 'bg-brand-sage text-white'
              : 'bg-brand-teal-soft/40 text-brand-teal-deep',
          )}
        >
          {group.complete ? (
            <Check className="size-4" strokeWidth={2.6} />
          ) : (
            <GroupIcon className="size-4" strokeWidth={2} />
          )}
        </div>
        <span className="text-brand-navy min-w-0 flex-1 truncate text-sm font-bold">
          {t(`setup_progress.groups.${group.group}`, { defaultValue: group.group })}
        </span>
        <span
          className={cn(
            'num shrink-0 text-xs font-bold',
            group.complete ? 'text-brand-sage-deep' : 'text-muted-foreground',
          )}
        >
          {t('setup_progress.group_counter', {
            done: group.doneCount,
            total: group.total,
            defaultValue: '{{done}}/{{total}}',
          })}
        </span>
        <ChevronRight
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
          strokeWidth={2.2}
        />
      </button>

      {/* Задания категории */}
      {open ? (
        <div className="border-border/60 flex flex-col gap-1.5 border-t px-2 py-2">
          {group.steps.map((step) => (
            <SetupTask
              key={step.id}
              step={step}
              onCta={cta[step.id]}
              onDismiss={() => onDismiss(step.id)}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SetupTask({
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
        'flex items-start gap-3 rounded-lg p-2.5 transition-colors',
        done ? 'bg-brand-sage-soft/20' : 'hover:bg-muted/40',
      )}
    >
      <div
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full',
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
            'text-sm font-semibold',
            done ? 'text-brand-sage-deep line-through' : 'text-brand-navy',
          )}
        >
          {t(`setup_progress.cards.${step.id}.title`)}
        </p>
        {done ? (
          <p className="text-brand-sage-deep mt-0.5 text-xs">
            {step.dismissed
              ? t('setup_progress.skipped', { defaultValue: 'Пропущено' })
              : t('setup_progress.done', { defaultValue: 'Готово' })}
          </p>
        ) : (
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {t(`setup_progress.cards.${step.id}.why`)}
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
