import { AlertTriangle, Info, Loader2, Sparkles, X, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useDismissInsight, useInsights, type InsightRow } from '@/hooks/useInsights'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

import type { LocalInsight } from './dashboard-aggregates'

/**
 * Дашборд-виджет AI-инсайтов. Показывает до 3-х актуальных инсайтов
 * (sorted by severity) с возможностью «Скрыть».
 *
 * Если в таблице insights пусто (новый салон / cron не отработал) —
 * рендерим переданный fallback с локально-посчитанными подсказками
 * (см. computeLocalInsights), чтобы блок «AI-помощник видит» не был
 * пустым на дашборде.
 */
export function InsightsWidget({
  salonId,
  fallback = [],
}: {
  salonId: string
  fallback?: LocalInsight[]
}) {
  const { t } = useTranslation()
  const { data: insights = [] } = useInsights(salonId)
  const dismiss = useDismissInsight(salonId)
  const qc = useQueryClient()
  const [generating, setGenerating] = useState(false)

  const hasServerInsights = insights.length > 0
  const hasFallback = fallback.length > 0

  // T170 — явный триггер «Запустить AI разбор». Вызывает generate-insights
  // и обновляет inservation кэш.
  async function runAiAnalysis() {
    if (!salonId) {
      // T191 — early return НЕ оставляет generating=true (тут он ещё false,
      // но защита от регрессии если кто-то поменяет порядок).
      setGenerating(false)
      return
    }
    setGenerating(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-insights', {
        body: { salon_id: salonId },
      })
      if (error) throw error
      // T188 — реальный response format: { ok: true, mode: 'manual', generated: N }.
      // generated=0 → у салона нет данных, показываем friendly empty toast.
      const result = data as { ok?: boolean; generated?: number } | null
      if (result?.generated === 0) {
        toast.info(t('dashboard.insights.run_no_data'))
        return
      }
      await qc.invalidateQueries({ queryKey: ['insights', salonId] })
      toast.success(t('dashboard.insights.run_done'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  if (!hasServerInsights && !hasFallback) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground text-sm">
          {t('dashboard.insights.empty', {
            defaultValue:
              'Пока всё спокойно. Если появится что-то требующее внимания — увидишь подсказку здесь.',
          })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={generating}
          onClick={runAiAnalysis}
        >
          {generating ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Sparkles className="size-3.5" strokeWidth={2} />
          )}
          {t('dashboard.insights.run_ai', { defaultValue: 'Запустить AI разбор' })}
        </Button>
      </div>
    )
  }

  return (
    <section className="border-secondary/20 bg-secondary/5 mb-5 rounded-lg border p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="text-secondary size-4" strokeWidth={2} />
        <h2 className="text-brand-navy text-sm font-bold uppercase tracking-wider">
          {t('dashboard.insights.title')}
        </h2>
      </div>
      <div className="flex flex-col gap-2.5">
        {hasServerInsights
          ? insights.map((i) => (
              <InsightCard
                key={i.id}
                insight={i}
                onDismiss={() => dismiss.mutate(i.id)}
                disabled={dismiss.isPending}
              />
            ))
          : fallback.map((i) => <LocalInsightCard key={i.id} insight={i} />)}
      </div>
    </section>
  )
}

function LocalInsightCard({ insight }: { insight: LocalInsight }) {
  const Icon =
    insight.severity === 'critical' ? AlertTriangle : insight.severity === 'warning' ? Zap : Info
  const colorClass =
    insight.severity === 'critical'
      ? 'text-destructive'
      : insight.severity === 'warning'
        ? 'text-amber-600'
        : 'text-brand-teal-deep'
  return (
    <div className="border-border bg-card flex items-start gap-3 rounded-md border p-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${colorClass}`} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="text-brand-navy text-sm font-bold">{insight.title}</p>
        <p className="text-foreground/80 mt-0.5 text-xs leading-snug">{insight.body}</p>
      </div>
    </div>
  )
}

function InsightCard({
  insight,
  onDismiss,
  disabled,
}: {
  insight: InsightRow
  onDismiss: () => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const Icon =
    insight.severity === 'critical' ? AlertTriangle : insight.severity === 'warning' ? Zap : Info
  const colorClass =
    insight.severity === 'critical'
      ? 'text-destructive'
      : insight.severity === 'warning'
        ? 'text-amber-600'
        : 'text-brand-teal-deep'

  return (
    <div className="border-border bg-card flex items-start gap-3 rounded-md border p-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${colorClass}`} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="text-brand-navy text-sm font-bold">{insight.title}</p>
        <p className="text-foreground/80 mt-0.5 text-xs leading-snug">{insight.body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        disabled={disabled}
        className="text-muted-foreground hover:text-destructive grid size-6 shrink-0 place-items-center rounded-md disabled:opacity-50"
        aria-label={t('dashboard.insights.dismiss')}
        title={t('dashboard.insights.dismiss')}
      >
        <X className="size-4" strokeWidth={1.7} />
      </button>
    </div>
  )
}
