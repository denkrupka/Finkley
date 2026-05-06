import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils/cn'

export type PeriodKey = 'day' | 'week' | 'month' | 'custom'

const OPTIONS: { id: PeriodKey; caret?: boolean }[] = [
  { id: 'day' },
  { id: 'week' },
  { id: 'month' },
  { id: 'custom', caret: true },
]

/**
 * Period-toggle из `Design/project/chrome.jsx` → `PeriodToggle`.
 * State хранится в URL `?period=` чтобы шарить ссылки на конкретный период.
 *
 * `custom` пока ведёт себя как обычная кнопка — date-picker подключим в TASK-23.
 */
export function PeriodToggle() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const value = (params.get('period') ?? 'month') as PeriodKey

  function set(next: PeriodKey) {
    const newParams = new URLSearchParams(params)
    newParams.set('period', next)
    setParams(newParams, { replace: true })
  }

  return (
    <div className="border-border bg-background inline-flex rounded-full border p-[3px]">
      {OPTIONS.map((opt) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => set(opt.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={active}
          >
            {t(`dashboard.period.${opt.id}`)}
            {opt.caret ? <ChevronDown className="size-3.5" strokeWidth={2} /> : null}
          </button>
        )
      })}
    </div>
  )
}
