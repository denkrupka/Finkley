import { Eye, Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

/**
 * Collapsed AI-вывод по отчёту в стиле AiInsightsPanel — жёлтая плашка
 * сверху таблицы: «AI-выводы по отчёту [Показать]». При клике дёргает onShow
 * (генерация / refresh) и раскрывается. Используется в Reports → Конкуренты
 * → Цены/Загруженность/Рейтинг/Контент.
 */
export function AiReportPanel({
  insights,
  isLoading,
  onShow,
  hint,
}: {
  insights: { title: string; body: string }[] | null
  isLoading: boolean
  onShow: () => void
  /** Подсказка под кнопкой «Показать», если выводов ещё нет. */
  hint?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  function handleClick() {
    setOpen(true)
    if (!insights) onShow()
  }

  return (
    <section className={'border-brand-yellow-deep/40 bg-brand-yellow/30 rounded-lg border p-4'}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="bg-brand-yellow-deep/30 text-brand-navy grid size-9 shrink-0 place-items-center rounded-full">
            <Sparkles className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-bold">
              {t('reports_hub.competitors.ai_panel_title')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {open && insights
                ? t('reports_hub.competitors.ai_panel_shown', { count: insights.length })
                : (hint ?? t('reports_hub.competitors.ai_panel_hint'))}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleClick}
          disabled={isLoading}
          variant={open ? 'outline' : 'primary'}
        >
          {isLoading ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Eye className="mr-1.5 size-3.5" strokeWidth={2} />
          )}
          {isLoading
            ? t('common.loading')
            : open && insights
              ? t('reports_hub.competitors.ai_panel_refresh')
              : t('reports_hub.competitors.ai_panel_show')}
        </Button>
      </div>

      {open && insights ? (
        insights.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {t('reports_hub.competitors.ai_empty')}
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {insights.map((it, i) => (
              <li key={i} className="border-border bg-card rounded-md border p-3">
                <p className="text-foreground text-xs font-bold">{it.title}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{it.body}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  )
}
