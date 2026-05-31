import { AlertCircle, ArrowRight, Eye, Lightbulb, Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useReportInsights, type InsightKind } from '@/hooks/useReportInsights'

const AI_PROMPT_KEY = 'finkley:ai-prefill-prompt'

/**
 * Жёлтая плашка над аналитической вкладкой /reports с AI-выводами по данным
 * отчёта. У каждого инсайта — кнопка «Что с этим делать?», которая
 * сохраняет prompt в sessionStorage и переходит на /ai — AIAssistantPage
 * подхватывает префилл и сразу отправляет в чат.
 *
 * Image #57: запрос к AI-функции **не** уходит автоматически при открытии
 * вкладки. Сначала пользователь видит свёрнутый CTA-блок с кнопкой
 * «Показать AI-выводы». Только клик по ней разворачивает плашку и пускает
 * запрос. Логика — токены AI стоят денег и каждое открытие отчёта без
 * нужды генерило бы расход; теперь юзер сам решает, когда вызывать AI.
 *
 * Использование:
 *   <AiInsightsPanel kind="services" payload={{ top_services, totals }} />
 */
export function AiInsightsPanel({ kind, payload }: { kind: InsightKind; payload: unknown }) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const navigate = useNavigate()
  const [revealed, setRevealed] = useState(false)
  const enabled = revealed && Boolean(salonId) && payload != null
  const {
    data: insights = [],
    isLoading,
    error,
    refetch,
  } = useReportInsights(salonId, kind, payload, enabled)

  function navigateToAiWithPrompt(prompt: string) {
    try {
      window.sessionStorage.setItem(AI_PROMPT_KEY, prompt)
    } catch {
      // ignore quota errors
    }
    navigate(`/${salonId}/ai`)
  }

  // До первого клика — компактная плашка с кнопкой «Показать». Запрос к AI
  // не уходит, токены не тратятся.
  if (!revealed) {
    return (
      <section className="border-brand-yellow-deep/40 bg-brand-yellow/30 mb-5 flex flex-col items-center justify-between gap-3 rounded-lg border p-4 sm:flex-row dark:border-amber-500/30 dark:bg-amber-500/10">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-brand-yellow-deep/20 text-brand-navy grid size-9 shrink-0 place-items-center rounded-full">
            <Sparkles className="size-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h3 className="text-brand-navy text-sm font-bold">{t('reports_insights.title')}</h3>
            <p className="text-brand-navy/80 dark:text-foreground/80 text-[11px]">
              {t('reports_insights.reveal_subtitle')}
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setRevealed(true)}
          data-testid="reveal-ai-insights"
        >
          <Eye className="size-4" strokeWidth={2} />
          {t('reports_insights.reveal_button')}
        </Button>
      </section>
    )
  }

  return (
    <section className="border-brand-yellow-deep/40 bg-brand-yellow/30 mb-5 rounded-lg border p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <header className="mb-3 flex items-center gap-2">
        <span className="bg-brand-yellow-deep/20 text-brand-navy grid size-7 shrink-0 place-items-center rounded-full">
          <Sparkles className="size-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-brand-navy text-sm font-bold">{t('reports_insights.title')}</h3>
          <p className="text-brand-navy/80 dark:text-foreground/80 text-[11px]">
            {t('reports_insights.subtitle')}
          </p>
        </div>
        {!isLoading && insights.length > 0 ? (
          <button
            type="button"
            onClick={() => refetch()}
            className="text-brand-navy/80 hover:text-brand-navy dark:text-foreground/80 dark:hover:text-foreground text-[11px] underline-offset-2 hover:underline"
          >
            {t('reports_insights.refresh')}
          </button>
        ) : null}
      </header>

      {isLoading ? (
        <div className="text-brand-navy/80 dark:text-foreground/80 flex items-center gap-2 text-xs">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} />
          {t('reports_insights.loading')}
        </div>
      ) : error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-md border p-3 text-xs">
          <AlertCircle className="size-4 shrink-0" strokeWidth={2} />
          <span className="flex-1">
            {error instanceof Error ? error.message : t('reports_insights.error_generic')}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-destructive hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : insights.length === 0 ? (
        <p className="text-brand-navy/80 dark:text-foreground/80 text-xs">
          {t('reports_insights.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {insights.map((ins, idx) => (
            <li
              key={idx}
              className="border-border bg-card flex items-start gap-3 rounded-md border p-3"
            >
              <Lightbulb
                className="text-brand-gold-deep mt-0.5 size-4 shrink-0"
                strokeWidth={1.8}
              />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-bold">{ins.title}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{ins.body}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigateToAiWithPrompt(ins.action_prompt)}
                className="shrink-0 whitespace-nowrap"
              >
                {t('reports_insights.action_button')}
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
