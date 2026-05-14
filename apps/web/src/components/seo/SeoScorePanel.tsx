import { AlertCircle, CheckCircle2, Clock, FileText, XCircle } from 'lucide-react'

import { type SeoResult } from '@/lib/seo/seo-utils'

/**
 * Боковая панель «SEO-оценка» — большой score 0-100, чек-лист из 12+ пунктов,
 * подсказки. Обновляется в реальном времени по мере редактирования статьи.
 */
export function SeoScorePanel({ result }: { result: SeoResult }) {
  const tone =
    result.score >= 85
      ? 'emerald'
      : result.score >= 65
        ? 'amber'
        : result.score >= 35
          ? 'orange'
          : 'rose'
  const RING: Record<string, string> = {
    emerald: 'stroke-emerald-500',
    amber: 'stroke-amber-500',
    orange: 'stroke-orange-500',
    rose: 'stroke-rose-500',
  }
  const TEXT: Record<string, string> = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    orange: 'text-orange-600',
    rose: 'text-rose-600',
  }
  const VERDICT: Record<string, string> = {
    emerald: 'Отличный SEO!',
    amber: 'Хорошо, можно лучше',
    orange: 'Нужна доработка',
    rose: 'Много проблем',
  }

  const circumference = 2 * Math.PI * 38
  const dashOffset = circumference - (result.score / 100) * circumference

  return (
    <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
      <div className="bg-gradient-to-br from-slate-50 to-white p-4">
        <div className="flex items-center gap-4">
          <svg width="100" height="100" viewBox="0 0 100 100" className="shrink-0">
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="none"
              strokeWidth="8"
              className="stroke-slate-200"
            />
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={`${RING[tone]} transition-all duration-500`}
            />
            <text
              x="50"
              y="50"
              textAnchor="middle"
              dominantBaseline="middle"
              className={`fill-current text-3xl font-bold ${TEXT[tone]}`}
            >
              {result.score}
            </text>
          </svg>
          <div className="min-w-0">
            <p className={`text-base font-bold ${TEXT[tone]}`}>{VERDICT[tone]}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              SEO Score · {result.checks.filter((c) => c.status === 'pass').length}/
              {result.checks.length} проверок
            </p>
            <div className="text-muted-foreground mt-2 flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3" strokeWidth={2} />
                {result.wordCount} слов
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" strokeWidth={2} />~{result.readingMinutes} мин
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-border max-h-[440px] overflow-y-auto border-t">
        <ul className="divide-border divide-y">
          {result.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2.5 px-4 py-2.5 text-xs">
              {c.status === 'pass' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" strokeWidth={2} />
              ) : c.status === 'warn' ? (
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" strokeWidth={2} />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" strokeWidth={2} />
              )}
              <div className="min-w-0">
                <p className="text-foreground font-semibold">{c.label}</p>
                {c.status !== 'pass' && c.hint ? (
                  <p className="text-muted-foreground mt-0.5 leading-snug">{c.hint}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
