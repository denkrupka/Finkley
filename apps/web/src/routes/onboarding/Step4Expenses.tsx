import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'

type Props = {
  value: string[]
  onChange: (v: string[]) => void
}

type GroupId = 'fixed' | 'variable' | 'taxes'

const GROUP_EXAMPLES: Record<GroupId, string[]> = {
  fixed: ['Аренда', 'Зарплата мастерам', 'Коммунальные услуги'],
  variable: ['Материалы', 'Реклама', 'Обучение', 'Прочее'],
  taxes: ['ZUS', 'PIT/CIT', 'VAT'],
}

const GROUP_META: Record<GroupId, { title: string; subtitle: string }> = {
  fixed: {
    title: 'Фиксированные расходы',
    subtitle:
      'Те, что платишь каждый месяц независимо от выручки. Они формируют точку безубыточности.',
  },
  variable: {
    title: 'Переменные расходы',
    subtitle:
      'Растут с числом клиентов: материалы, реклама, обучение. Их мы автоматом разнесём по визитам.',
  },
  taxes: {
    title: 'Налоги и взносы',
    subtitle:
      'ZUS, налог на прибыль, VAT — учитываем отдельно от расходов. В P&L пойдут после прибыли.',
  },
}

/**
 * T82 — разделение списка категорий на 3 группы для онбординга. Каждая
 * группа — раскрываемая секция с краткой инструкцией: за что отвечает,
 * примеры. Категория добавляется как обычная строка в общий массив
 * value[] (бэкенд не меняем) — для онбординга это достаточно. После
 * входа в портал юзер сможет настроить структуру глубже в
 * Настройки → Справочники → Финансы (там полноценный FinancialSettings).
 */
export function Step4Expenses({ value, onChange }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<Record<GroupId, boolean>>({
    fixed: true,
    variable: false,
    taxes: false,
  })

  // Простая эвристика: к какой группе принадлежит строка (case-insensitive
  // substring match). Если ни к одной — кладём в variable.
  function groupOf(name: string): GroupId {
    const low = name.toLowerCase()
    if (
      low.includes('аренд') ||
      low.includes('зарплат') ||
      low.includes('коммун') ||
      low.includes('rent') ||
      low.includes('salary')
    )
      return 'fixed'
    if (low.includes('zus') || low.includes('налог') || low.includes('vat') || low.includes('pit'))
      return 'taxes'
    return 'variable'
  }

  function update(i: number, name: string) {
    const next = [...value]
    next[i] = name
    onChange(next)
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }
  function add(group: GroupId, name = '') {
    onChange([...value, name])
    if (!open[group]) setOpen({ ...open, [group]: true })
  }
  function toggle(g: GroupId) {
    setOpen({ ...open, [g]: !open[g] })
  }

  return (
    <div>
      <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
        {t('onboarding.step4.title', { defaultValue: 'Расходы салона' })}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step4.subtitle_v2', {
          defaultValue:
            'Раздели расходы на 3 группы — это нужно, чтобы AI правильно строил P&L и считал реальную прибыль. Точные суммы укажешь позже в Настройках.',
        })}
      </p>

      <div className="mt-7 flex flex-col gap-3" data-testid="onb-expenses">
        {(['fixed', 'variable', 'taxes'] as GroupId[]).map((g) => {
          const meta = GROUP_META[g]
          const indices = value
            .map((cat, idx) => ({ cat, idx }))
            .filter(({ cat }) => groupOf(cat) === g)
          return (
            <section key={g} className="border-border overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => toggle(g)}
                className="bg-muted/30 hover:bg-muted/50 flex w-full items-start gap-2 px-3 py-2.5 text-left"
              >
                {open[g] ? (
                  <ChevronDown
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    strokeWidth={2}
                  />
                ) : (
                  <ChevronRight
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    strokeWidth={2}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-bold">{meta.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                    {meta.subtitle}
                  </p>
                </div>
                <span className="text-muted-foreground bg-card rounded-full px-2 py-0.5 text-xs font-semibold">
                  {indices.length}
                </span>
              </button>

              <div className={cn(open[g] ? '' : 'hidden', 'px-3 py-3')}>
                <div className="flex flex-col gap-2">
                  {indices.length === 0 ? (
                    <p className="text-muted-foreground text-xs italic">
                      Пока пусто — добавь категории ниже или из примеров.
                    </p>
                  ) : (
                    indices.map(({ cat, idx }) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          value={cat}
                          onChange={(e) => update(idx, e.target.value)}
                          placeholder={t('onboarding.step4.placeholder', {
                            defaultValue: 'Название категории',
                          })}
                        />
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="border-border text-muted-foreground hover:text-destructive grid size-9 shrink-0 place-items-center rounded-md border"
                          aria-label="remove"
                        >
                          <Trash2 className="size-4" strokeWidth={1.7} />
                        </button>
                      </div>
                    ))
                  )}

                  {/* Примеры — клик добавляет в эту группу */}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {GROUP_EXAMPLES[g]
                      .filter((ex) => !value.includes(ex))
                      .map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => add(g, ex)}
                          className="border-border bg-card hover:bg-muted/40 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                        >
                          <Plus className="size-3" strokeWidth={2.2} />
                          {ex}
                        </button>
                      ))}
                    <button
                      type="button"
                      onClick={() => add(g)}
                      className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[11px] font-semibold"
                    >
                      <Plus className="size-3" strokeWidth={2.2} />
                      {t('onboarding.step4.add_custom', { defaultValue: 'Своя' })}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )
        })}
      </div>

      <p className="text-muted-foreground mt-4 text-xs">
        {t('onboarding.step4.hint_settings', {
          defaultValue:
            'Точные суммы (аренда, ZUS, % налога) укажешь в Настройках → Справочники → Финансы. Здесь — только структура категорий.',
        })}
      </p>
    </div>
  )
}
