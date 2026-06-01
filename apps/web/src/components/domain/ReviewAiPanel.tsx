import { Brain, Copy, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { renderMarkdownInline } from '@/lib/utils/render-markdown-inline'
import {
  type BulkContent,
  type ReviewAiResponse,
  type ReviewAiScope,
  type SingleExternalContent,
  type SingleInternalContent,
  useReviewAiAnalyze,
} from '@/hooks/useReviewAi'

type Props = {
  salonId: string
  scope: ReviewAiScope
  reviewId?: string
  /** external (Booksy/Google) или internal — определяет какие поля показывать в single */
  reviewSource?: 'booksy' | 'google' | 'internal'
  /** Компактный вид — кнопка-иконка вместо большой кнопки */
  compact?: boolean
}

export function ReviewAiPanel({ salonId, scope, reviewId, reviewSource, compact }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<ReviewAiResponse | null>(null)
  const analyze = useReviewAiAnalyze(salonId)

  function run(force = false) {
    setOpen(true)
    analyze.mutate(
      { scope, review_id: reviewId, force },
      {
        onSuccess: (res) => setResult(res),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => run(false)}
        className={
          compact
            ? 'border-border bg-card text-foreground hover:bg-muted/40 inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-semibold transition-colors'
            : 'border-border bg-card text-foreground hover:bg-muted/40 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors'
        }
      >
        <Sparkles className={compact ? 'size-3' : 'size-3.5'} strokeWidth={2} />
        {t('reports_hub.reviews.ai.button')}
      </button>
    )
  }

  return (
    <div className="border-brand-sage-deep/30 from-brand-sage/5 mt-3 rounded-lg border bg-gradient-to-br to-transparent p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
          <Brain className="text-brand-sage-deep size-4" strokeWidth={2} />
          {t('reports_hub.reviews.ai.title')}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => run(true)}
            disabled={analyze.isPending}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50"
            title={t('reports_hub.reviews.ai.refresh')}
          >
            <RefreshCw className={analyze.isPending ? 'size-3 animate-spin' : 'size-3'} />
            {t('reports_hub.reviews.ai.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground text-[11px] font-semibold"
          >
            ✕
          </button>
        </div>
      </div>

      {analyze.isPending && !result ? (
        <p className="text-muted-foreground py-6 text-center text-xs">
          {t('reports_hub.reviews.ai.loading')}
        </p>
      ) : result ? (
        <RenderContent
          content={result.content}
          scope={scope}
          reviewSource={reviewSource}
          cached={result.cached}
        />
      ) : null}
    </div>
  )
}

function RenderContent({
  content,
  scope,
  reviewSource,
  cached,
}: {
  content: ReviewAiResponse['content']
  scope: ReviewAiScope
  reviewSource?: 'booksy' | 'google' | 'internal'
  cached: boolean
}) {
  if (scope === 'single') {
    if (reviewSource === 'internal') {
      return <SingleInternalRender c={content as SingleInternalContent} cached={cached} />
    }
    return <SingleExternalRender c={content as SingleExternalContent} cached={cached} />
  }
  return <BulkRender c={content as BulkContent} cached={cached} />
}

function CachedBadge({ cached }: { cached: boolean }) {
  const { t } = useTranslation()
  if (!cached) return null
  return (
    <span className="text-muted-foreground/70 ml-2 text-[10px] uppercase tracking-wider">
      {t('reports_hub.reviews.ai.cached')}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-brand-sage-deep mb-1 text-[10px] font-bold uppercase tracking-wider">
        {title}
      </div>
      <div className="text-foreground text-xs leading-relaxed">{children}</div>
    </div>
  )
}

function CopyableMessage({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation()
  return (
    <div className="border-border bg-card mb-3 rounded-md border p-3">
      <div className="text-muted-foreground mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text)
            toast.success(t('common.copied'))
          }}
          className="hover:text-foreground inline-flex items-center gap-1 text-[10px] font-semibold"
        >
          <Copy className="size-3" /> {t('reports_hub.reviews.ai.copy')}
        </button>
      </div>
      <p className="text-foreground whitespace-pre-wrap text-xs leading-relaxed">{text}</p>
    </div>
  )
}

function ProfileTable({ p }: { p: SingleExternalContent['psychological_profile'] }) {
  const { t } = useTranslation()
  const rows: [string, string][] = [
    [t('reports_hub.reviews.ai.profile.tone'), p.tone],
    [t('reports_hub.reviews.ai.profile.emotion'), p.emotion],
    [t('reports_hub.reviews.ai.profile.temperament'), p.temperament],
    [t('reports_hub.reviews.ai.profile.style'), p.communication_style],
    [t('reports_hub.reviews.ai.profile.service_context'), p.service_context],
  ]
  return (
    <dl className="border-border/40 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded border bg-white/40 p-3">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
            {k}
          </dt>
          <dd className="text-foreground text-xs">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function SingleExternalRender({ c, cached }: { c: SingleExternalContent; cached: boolean }) {
  const { t } = useTranslation()
  return (
    <div>
      <CachedBadge cached={cached} />
      <Section title={t('reports_hub.reviews.ai.s.situation')}>{c.situation}</Section>
      <Section title={t('reports_hub.reviews.ai.s.root_cause')}>{c.root_cause}</Section>
      <Section title={t('reports_hub.reviews.ai.s.prevention')}>
        <ul className="ml-4 list-disc space-y-0.5">
          {c.prevention.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </Section>
      <Section title={t('reports_hub.reviews.ai.s.public_impact')}>{c.public_impact}</Section>
      <Section title={t('reports_hub.reviews.ai.s.profile')}>
        <ProfileTable p={c.psychological_profile} />
      </Section>
      <Section title={t('reports_hub.reviews.ai.s.response')}>
        <ul className="space-y-1">
          <li>
            <b>{t('reports_hub.reviews.ai.s.approach')}:</b> {c.response_strategy.approach}
          </li>
          <li>
            <b>{t('reports_hub.reviews.ai.s.offer')}:</b> {c.response_strategy.offer}
          </li>
          <li>
            <b>{t('reports_hub.reviews.ai.s.hook')}:</b> {c.response_strategy.key_hook}
          </li>
        </ul>
      </Section>
      <CopyableMessage
        label={t('reports_hub.reviews.ai.s.public_reply')}
        text={c.suggested_public_reply}
      />
      <CopyableMessage
        label={t('reports_hub.reviews.ai.s.private_message')}
        text={c.suggested_private_message}
      />
    </div>
  )
}

function SingleInternalRender({ c, cached }: { c: SingleInternalContent; cached: boolean }) {
  const { t } = useTranslation()
  return (
    <div>
      <CachedBadge cached={cached} />
      <Section title={t('reports_hub.reviews.ai.s.situation')}>{c.situation}</Section>
      <Section title={t('reports_hub.reviews.ai.s.root_cause')}>{c.root_cause}</Section>
      <Section title={t('reports_hub.reviews.ai.s.prevention')}>
        <ul className="ml-4 list-disc space-y-0.5">
          {c.prevention.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </Section>
      <Section title={t('reports_hub.reviews.ai.s.staff_action')}>{c.staff_action}</Section>
      <Section title={t('reports_hub.reviews.ai.s.profile')}>
        <ProfileTable p={c.psychological_profile} />
      </Section>
      <Section title={t('reports_hub.reviews.ai.s.retention')}>
        <ul className="space-y-1">
          <li>
            <b>{t('reports_hub.reviews.ai.s.approach')}:</b> {c.retention_strategy.approach}
          </li>
          <li>
            <b>{t('reports_hub.reviews.ai.s.offer')}:</b> {c.retention_strategy.offer}
          </li>
          <li>
            <b>{t('reports_hub.reviews.ai.s.hook')}:</b> {c.retention_strategy.key_hook}
          </li>
        </ul>
      </Section>
      <CopyableMessage
        label={t('reports_hub.reviews.ai.s.private_message')}
        text={c.suggested_private_message}
      />
    </div>
  )
}

function BulkRender({ c, cached }: { c: BulkContent; cached: boolean }) {
  const { t } = useTranslation()
  return (
    <div>
      <CachedBadge cached={cached} />
      <Section title={t('reports_hub.reviews.ai.b.overview')}>
        {renderMarkdownInline(c.overview)}
      </Section>
      {c.patterns?.length ? (
        <Section title={t('reports_hub.reviews.ai.b.patterns')}>
          <ul className="space-y-1.5">
            {c.patterns.map((p, i) => (
              <li key={i}>
                <b>{renderMarkdownInline(p.title)}:</b> {renderMarkdownInline(p.description)}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {c.top_actions?.length ? (
        <Section title={t('reports_hub.reviews.ai.b.top_actions')}>
          <ol className="ml-4 list-decimal space-y-0.5">
            {c.top_actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </Section>
      ) : null}
      {c.segments?.length ? (
        <Section title={t('reports_hub.reviews.ai.b.segments')}>
          <ul className="space-y-1.5">
            {c.segments.map((s, i) => (
              <li key={i}>
                <b>{s.name}:</b> {s.approach}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {c.risk_assessment ? (
        <Section title={t('reports_hub.reviews.ai.b.risk')}>{c.risk_assessment}</Section>
      ) : null}
    </div>
  )
}
