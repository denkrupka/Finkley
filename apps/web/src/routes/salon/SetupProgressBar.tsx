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
import { useClaimSetupReward, useSetupProgress } from '@/hooks/useSetupProgress'
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

type TFn = (k: string, opts?: Record<string, unknown>) => string

/**
 * Общий хук «Настройки Finkley»: тянет серверный прогресс + клиентские пропуски,
 * считает проценты/счётчик/награду через чистый lib/setup-progress.ts. Возвращает
 * `null`, когда бар показывать не нужно (не owner / всё готово / слишком старый
 * салон). Один query (React Query дедуплицирует) шарится верхним баром и нижним
 * виджетом — оба рендерят одинаковые числа без prop-drilling.
 */
/** Задания нельзя пропускать — только выполнять (трекинг). dismissed всегда
 *  пуст: готовность/процент считаются строго по серверным данным. */
const NO_DISMISSED: ReadonlySet<SetupStepId> = new Set()

function useSetupBarModel(salonId: string) {
  const { data: progress } = useSetupProgress(salonId)
  const { data: membership } = useSalonMembership(salonId)

  const steps = useMemo(
    () => (progress ? computeSetupSteps(progress, NO_DISMISSED) : []),
    [progress],
  )
  const groups = useMemo(() => groupSetupSteps(steps), [steps])

  if (!progress) return null
  if (!shouldShowSetupBar(progress, steps, membership?.role)) return null

  return {
    progress,
    steps,
    groups,
    percent: computePercent(steps),
    remaining: remainingSteps(steps),
    eligible: isRewardEligible(progress, steps),
    daysLeft: rewardDaysLeft(progress.created_at),
  }
}

/**
 * Текст подсказки: «всё готово» ТОЛЬКО когда реально не осталось заданий.
 * Если награда доступна (core готов), но extra-задания ещё есть — показываем
 * «осталось N · заберите +14 дней 🎁», а не ложное «всё готово».
 */
function collapsedHintText(
  t: TFn,
  remaining: number,
  eligible: boolean,
  remainingPercent: number,
): string {
  if (remaining === 0) return t('setup_progress.all_done', { defaultValue: 'всё готово 🎉' })
  // «ещё N%» — наглядно показываем, сколько прогресса осталось добрать.
  const pct = t('setup_progress.left_percent', {
    percent: remainingPercent,
    defaultValue: 'ещё {{percent}}%',
  })
  const base = eligible
    ? t('setup_progress.tasks_left_reward', {
        count: remaining,
        defaultValue: 'осталось {{count}} · заберите +14 дней 🎁',
      })
    : t('setup_progress.tasks_left', {
        count: remaining,
        defaultValue: 'осталось {{count}} заданий',
      })
  return `${base} · ${pct}`
}

/**
 * «Настройка Finkley» — gamified прогресс первичной настройки (T2 / v3).
 *
 * Состоит из ДВУХ скоординированных частей с общим `expanded`-стейтом (он
 * поднят в SalonLayout):
 *   - {@link SetupProgressBar} — тонкая полноширинная плашка СВЕРХУ, всегда
 *     видна в потоке layout (под SyncStatusBanner). Клик раскрывает виджет.
 *   - {@link SetupProgressWidget} — плавающий справа-снизу виджет (свёрнутый бар
 *     + раскрывающийся вверх Stripe-style чек-лист). Рендерится в общем
 *     flex-стеке с FAB, так что FAB всегда над ним.
 *
 * Прогресс считается на сервере (RPC setup_progress); проценты/видимость/награда
 * — в lib/setup-progress.ts (покрыто тестами).
 */

/**
 * Верхний статус-бар (Z1): тонкая полноширинная плашка в потоке layout.
 * Всегда виден пока есть незакрытые задания; клик раскрывает нижний виджет.
 */
export function SetupProgressBar({
  salonId,
  expanded,
  onToggleExpanded,
}: {
  salonId: string
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const { t } = useTranslation()
  const model = useSetupBarModel(salonId)
  if (!model) return null

  const { percent, remaining, eligible } = model
  const hint = collapsedHintText(t, remaining, eligible, 100 - percent)

  return (
    <button
      type="button"
      onClick={onToggleExpanded}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-center gap-3 border-b px-4 py-2 text-left transition-colors sm:px-6',
        eligible
          ? 'border-brand-gold-deep/30 bg-brand-gold-soft/30 hover:bg-brand-gold-soft/50'
          : 'border-brand-sage/25 bg-brand-sage-soft/40 hover:bg-brand-sage-soft/60',
      )}
    >
      <Sparkles
        className={cn(
          'size-4 shrink-0',
          eligible ? 'text-brand-gold-deep' : 'text-brand-sage-deep',
        )}
        strokeWidth={2.2}
      />
      <span className="text-brand-navy shrink-0 text-sm font-bold">
        {t('setup_progress.title', { defaultValue: 'Настройка Finkley' })}
      </span>
      <span
        className={cn(
          'num shrink-0 text-sm font-extrabold',
          eligible ? 'text-brand-gold-deep' : 'text-brand-sage-deep',
        )}
      >
        {percent}%
      </span>
      <span className="text-muted-foreground hidden truncate text-xs sm:inline">·</span>
      <span className="text-muted-foreground hidden min-w-0 flex-1 truncate text-xs sm:inline">
        {hint}
      </span>
      {/* Прогресс-шкала — занимает остаток на десктопе, прячется когда есть текст;
          на мобиле растягивается на всю свободную ширину. */}
      <div
        className={cn(
          'mx-1 h-[5px] min-w-[64px] flex-1 overflow-hidden rounded-full sm:max-w-[160px] sm:flex-none',
          'bg-muted',
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            eligible ? 'bg-brand-gold-deep' : 'bg-brand-sage',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <ChevronDown
        className={cn(
          'size-4 shrink-0 transition-transform',
          eligible ? 'text-brand-gold-deep' : 'text-brand-sage-deep',
          expanded && 'rotate-180',
        )}
        strokeWidth={2.2}
      />
    </button>
  )
}

/**
 * Плавающий виджет (Z2): свёрнутый бар + раскрывающийся вверх чек-лист.
 * НЕ позиционируется сам — живёт внутри общего flex-стека SalonLayout
 * (FAB сверху, виджет снизу), поэтому FAB всегда над ним.
 */
export function SetupProgressWidget({
  salonId,
  expanded,
  onToggleExpanded,
  onCollapse,
  onAddVisit,
  onAddExpense,
}: {
  salonId: string
  expanded: boolean
  onToggleExpanded: () => void
  onCollapse: () => void
  onAddVisit: () => void
  onAddExpense: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const claim = useClaimSetupReward(salonId)
  const model = useSetupBarModel(salonId)
  const [openGroups, setOpenGroups] = useState<Set<SetupStepGroup>>(() => new Set())

  // При смене салона сбрасываем раскрытые категории.
  useEffect(() => {
    setOpenGroups(new Set())
  }, [salonId])

  const groups = model?.groups

  // При первом раскрытии — авто-раскрыть первую незавершённую категорию,
  // чтобы юзер сразу видел, что делать (Stripe-паттерн).
  useEffect(() => {
    if (!expanded || !groups) return
    setOpenGroups((prev) => {
      if (prev.size > 0) return prev
      const firstIncomplete = groups.find((g) => !g.complete)
      return firstIncomplete ? new Set([firstIncomplete.group]) : prev
    })
  }, [expanded, groups])

  if (!model) return null

  const { percent, remaining, eligible, daysLeft } = model
  const hint = collapsedHintText(t, remaining, eligible, 100 - percent)

  function toggleGroup(group: SetupStepGroup) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const go = (to: string) => () => {
    onCollapse()
    navigate(to)
  }

  const cta: CtaMap = {
    // core
    visit: () => {
      onCollapse()
      onAddVisit()
    },
    expense: () => {
      onCollapse()
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
              code: res.code ?? '',
              defaultValue:
                '🎁 Промокод €20: {{code}} — отправили на email. Примените при оплате подписки.',
            }),
            { duration: 12000 },
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

  return (
    <div className="flex w-[420px] max-w-[calc(100vw-2rem)] flex-col">
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
              onClick={onCollapse}
              className="text-muted-foreground hover:text-foreground -mr-1 grid size-7 shrink-0 place-items-center rounded-md"
              aria-label={t('common.close', { defaultValue: 'Закрыть' })}
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>

          {/* Скролл-контент */}
          <div className="overflow-y-auto px-3 py-3">
            {/* Плашка приза «+14 дней» — компактная. Награда доступна (eligible)
                → активный золотой вид + кнопка. Награда ещё не готова → неактивный
                (приглушённый, серый) вид, без кнопки. */}
            <div
              className={cn(
                'mb-3 flex items-start gap-2.5 rounded-lg border p-2.5',
                eligible
                  ? 'border-brand-gold-deep bg-brand-gold-soft'
                  : 'border-border bg-muted/40',
              )}
            >
              <Gift
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  eligible ? 'text-brand-gold-deep' : 'text-muted-foreground',
                )}
                strokeWidth={2}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-xs leading-snug',
                    eligible ? 'text-brand-navy font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {eligible
                    ? t('setup_progress.reward.ready', {
                        defaultValue: 'Подарок готов — заберите +14 дней демо.',
                      })
                    : t('setup_progress.reward.promise', {
                        days: daysLeft,
                        defaultValue:
                          'Бонус +14 дней демо — за выполнение ключевых заданий ({{days}} дн.).',
                      })}
                </p>
                {eligible ? (
                  <button
                    type="button"
                    onClick={handleClaim}
                    disabled={claim.isPending}
                    className="bg-brand-gold-deep mt-2 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
            </div>

            {/* Категории-аккордеоны */}
            <div className="flex flex-col gap-2">
              {model.groups.map((group) => (
                <SetupGroupSection
                  key={group.group}
                  group={group}
                  open={openGroups.has(group.group)}
                  onToggle={() => toggleGroup(group.group)}
                  cta={cta}
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
        onClick={onToggleExpanded}
        className={cn(
          // ВАЖНО: фон НЕпрозрачный (виджет плавает над контентом) — без /alpha,
          // иначе сквозь него просвечивают тексты/полоски дашборда.
          'relative flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left shadow-xl transition hover:brightness-[0.97]',
          eligible ? 'border-brand-gold-deep bg-brand-gold-soft' : 'border-brand-sage/50 bg-card',
        )}
        aria-expanded={expanded}
      >
        {/* Пульсирующая точка-нотификация — притягивает взгляд, пока есть задания */}
        {!expanded ? (
          <span className="absolute -right-1.5 -top-1.5 flex size-3.5">
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                eligible ? 'bg-brand-gold-deep' : 'bg-brand-sage',
              )}
            />
            <span
              className={cn(
                'relative inline-flex size-3.5 rounded-full ring-2 ring-white',
                eligible ? 'bg-brand-gold-deep' : 'bg-brand-sage',
              )}
            />
          </span>
        ) : null}
        <Sparkles
          className={cn(
            'size-5 shrink-0',
            eligible ? 'text-brand-gold-deep' : 'text-brand-sage-deep',
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
                eligible ? 'text-brand-gold-deep' : 'text-brand-sage-deep',
              )}
            >
              {percent}%
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{hint}</p>
          {/* Прогресс-полоска */}
          <div className={cn('mt-1.5 h-[5px] w-full overflow-hidden rounded-full', 'bg-muted')}>
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                eligible ? 'bg-brand-gold-deep' : 'bg-brand-sage',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform',
            eligible ? 'text-brand-gold-deep' : 'text-brand-sage-deep',
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
  t,
}: {
  group: SetupGroupView
  open: boolean
  onToggle: () => void
  cta: CtaMap
  t: TFn
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
              : 'bg-brand-sage-soft/50 text-brand-sage-deep',
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
            <SetupTask key={step.id} step={step} onCta={cta[step.id]} t={t} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SetupTask({ step, onCta, t }: { step: SetupStep; onCta: () => void; t: TFn }) {
  const Icon = ICONS[step.id]
  const done = step.done
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg p-2.5 transition-colors',
        done ? 'bg-brand-sage-soft/20' : 'hover:bg-muted/40',
      )}
    >
      {/* Строка 1: иконка + заголовок/описание. */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full',
            done ? 'bg-brand-sage text-white' : 'bg-brand-sage-soft/50 text-brand-sage-deep',
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
              {t('setup_progress.done', { defaultValue: 'Готово' })}
            </p>
          ) : (
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
              {t(`setup_progress.cards.${step.id}.why`)}
            </p>
          )}
        </div>
      </div>

      {/* Строка 2: только CTA — задания нельзя пропускать, лишь выполнять. */}
      {!done ? (
        <div className="pl-11">
          <button
            type="button"
            onClick={onCta}
            className="bg-brand-navy hover:bg-brand-navy/90 inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold text-white transition-colors"
          >
            {t(`setup_progress.cards.${step.id}.cta`)}
          </button>
        </div>
      ) : null}
    </div>
  )
}
