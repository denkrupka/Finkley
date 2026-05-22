import { AlertCircle, Loader2, Mail, MessageSquare, Send, Sparkles, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { getBroadcastTemplates, type BroadcastTemplate } from './broadcast-templates'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useClients } from '@/hooks/useClients'
import { useBroadcastPreview, useSendBroadcast, type BroadcastSegment } from '@/hooks/useMarketing'
import { cn } from '@/lib/utils/cn'

const textareaClass =
  'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

const SEGMENT_OPTIONS: { value: Exclude<BroadcastSegment, { tag: string }>; key: string }[] = [
  { value: 'all', key: 'marketing.compose.segment_all' },
  { value: 'new', key: 'marketing.compose.segment_new' },
  { value: 'regular', key: 'marketing.compose.segment_regular' },
  { value: 'dormant', key: 'marketing.compose.segment_dormant' },
]

const SMS_LIMIT = 160

/**
 * Marketing → «Создать рассылку».
 * Сегмент → каналы → тексты → превью → отправка.
 */
export function ComposeBroadcastTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [segment, setSegment] = useState<BroadcastSegment>('all')
  const [tagInput, setTagInput] = useState('')
  const [useTagSegment, setUseTagSegment] = useState(false)
  const [smsEnabled, setSmsEnabled] = useState(true)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [smsText, setSmsText] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const effectiveSegment: BroadcastSegment = useTagSegment ? { tag: tagInput.trim() } : segment

  const channels = { sms: smsEnabled, email: emailEnabled }
  const canPreview = (smsEnabled || emailEnabled) && (!useTagSegment || tagInput.trim().length > 0)

  const preview = useBroadcastPreview(salonId, effectiveSegment, channels)
  const send = useSendBroadcast(salonId)

  const smsCharCount = smsText.length
  const smsOverLimit = smsCharCount > SMS_LIMIT
  const smsExtraParts = Math.ceil(smsCharCount / SMS_LIMIT)

  function validate(): string | null {
    if (!smsEnabled && !emailEnabled) return t('marketing.compose.err_no_channel')
    if (smsEnabled && !smsText.trim()) return t('marketing.compose.err_sms_text_required')
    if (emailEnabled && (!emailSubject.trim() || !emailBody.trim())) {
      return t('marketing.compose.err_email_required')
    }
    if (useTagSegment && !tagInput.trim()) return t('marketing.compose.err_tag_required')
    if (preview.data && preview.data.eligible === 0) {
      return t('marketing.compose.err_no_recipients')
    }
    return null
  }

  function handleSend() {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    send.mutate(
      {
        segment: effectiveSegment,
        channels,
        sms_text: smsEnabled ? smsText.trim() : undefined,
        email_subject: emailEnabled ? emailSubject.trim() : undefined,
        email_body: emailEnabled ? emailBody.trim() : undefined,
      },
      {
        onSuccess: (r) => {
          toast.success(
            t('marketing.compose.sent_summary', {
              sms: r.sent_sms,
              email: r.sent_email,
              total: r.eligible,
            }),
          )
          if (r.skipped_no_balance > 0) {
            toast.warning(t('marketing.compose.warn_no_balance', { count: r.skipped_no_balance }))
          }
          if (r.skipped_paused > 0) {
            toast.warning(t('marketing.compose.warn_paused'))
          }
          setConfirmOpen(false)
          // Очищать форму не будем — юзер может захотеть исправить и отправить ещё.
        },
        onError: (e) =>
          toast.error(
            t('marketing.compose.err_send_failed', {
              message: e instanceof Error ? e.message : String(e),
            }),
          ),
      },
    )
  }

  function applyTemplate(tpl: BroadcastTemplate) {
    setSmsText(tpl.sms)
    setEmailSubject(tpl.subject)
    setEmailBody(tpl.bodyHtml)
    // Если юзер выбрал шаблон — включаем оба канала (он явно хочет рассылать).
    if (!smsEnabled) setSmsEnabled(true)
    if (!emailEnabled) setEmailEnabled(true)
    toast.success(t('marketing.compose.template_applied', { name: tpl.label }))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ----------- Шаблоны ----------- */}
      <section className="border-brand-sage-soft bg-brand-sage-soft/15 rounded-lg border p-5">
        <h3 className="text-brand-navy flex items-center gap-2 text-base font-bold tracking-tight">
          <Sparkles className="size-4" strokeWidth={2} />
          {t('marketing.compose.templates_title')}
        </h3>
        <p className="text-muted-foreground mb-3 mt-1 text-xs">
          {t('marketing.compose.templates_subtitle')}
        </p>
        <div className="flex flex-wrap gap-2">
          {getBroadcastTemplates().map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className="border-border bg-card text-foreground hover:border-brand-sage hover:bg-brand-sage-soft/30 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors"
            >
              <span className="text-base leading-none">{tpl.emoji}</span>
              {tpl.label}
            </button>
          ))}
        </div>
      </section>

      {/* ----------- Сегмент ----------- */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h3 className="text-brand-navy flex items-center gap-2 text-base font-bold tracking-tight">
          <Users className="size-4" strokeWidth={2} />
          {t('marketing.compose.segment_title')}
        </h3>
        <p className="text-muted-foreground mb-3 mt-1 text-xs">
          {t('marketing.compose.segment_subtitle')}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SEGMENT_OPTIONS.map((opt) => (
            <SegmentPill
              key={opt.value}
              label={t(opt.key)}
              active={!useTagSegment && segment === opt.value}
              onClick={() => {
                setUseTagSegment(false)
                setSegment(opt.value)
              }}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Label className="flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={useTagSegment}
              onChange={(e) => setUseTagSegment(e.target.checked)}
              className="size-4"
            />
            {t('marketing.compose.segment_by_tag')}
          </Label>
          <TagSelect
            salonId={salonId}
            value={tagInput}
            onChange={setTagInput}
            disabled={!useTagSegment}
          />
        </div>
      </section>

      {/* ----------- Каналы ----------- */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold tracking-tight">
          {t('marketing.compose.channels_title')}
        </h3>
        <p className="text-muted-foreground mb-3 mt-1 text-xs">
          {t('marketing.compose.channels_subtitle')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ChannelToggleBig
            icon={MessageSquare}
            label="SMS"
            active={smsEnabled}
            onClick={() => setSmsEnabled((v) => !v)}
          />
          <ChannelToggleBig
            icon={Mail}
            label="Email"
            active={emailEnabled}
            onClick={() => setEmailEnabled((v) => !v)}
          />
        </div>
      </section>

      {/* ----------- Тексты ----------- */}
      {smsEnabled ? (
        <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-brand-navy flex items-center gap-2 text-base font-bold tracking-tight">
              <MessageSquare className="size-4" strokeWidth={2} />
              {t('marketing.compose.sms_title')}
            </h3>
            <span
              className={cn(
                'num text-xs font-semibold',
                smsOverLimit ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {smsCharCount} / {SMS_LIMIT}
              {smsOverLimit
                ? ` · ${t('marketing.compose.sms_parts', { count: smsExtraParts })}`
                : ''}
            </span>
          </div>
          <textarea
            value={smsText}
            onChange={(e) => setSmsText(e.target.value)}
            placeholder={t('marketing.compose.sms_placeholder')}
            rows={4}
            className={cn(textareaClass, 'resize-y')}
          />
          {smsOverLimit ? (
            <p className="bg-destructive/10 text-destructive mt-2 flex items-start gap-1.5 rounded-md p-2 text-xs">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
              {t('marketing.compose.sms_over_limit_warn', { count: smsExtraParts })}
            </p>
          ) : null}
        </section>
      ) : null}

      {emailEnabled ? (
        <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
          <h3 className="text-brand-navy flex items-center gap-2 text-base font-bold tracking-tight">
            <Mail className="size-4" strokeWidth={2} />
            {t('marketing.compose.email_title')}
          </h3>
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <Label htmlFor="compose-subject" className="mb-1.5 block text-xs font-semibold">
                {t('marketing.compose.email_subject_label')}
              </Label>
              <Input
                id="compose-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder={t('marketing.compose.email_subject_placeholder')}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-semibold">
                {t('marketing.compose.email_body_label')}
              </Label>
              <RichTextEditor
                value={emailBody}
                onChange={setEmailBody}
                placeholder={t('marketing.compose.email_body_placeholder')}
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* ----------- Превью + Send ----------- */}
      <section className="border-brand-sage-soft bg-brand-sage-soft/20 rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold tracking-tight">
          {t('marketing.compose.preview_title')}
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <PreviewStat
            label={t('marketing.compose.preview_total')}
            value={canPreview ? (preview.data?.total_in_segment ?? '—') : '—'}
          />
          <PreviewStat
            label={t('marketing.compose.preview_can_sms')}
            value={canPreview && smsEnabled ? (preview.data?.can_sms ?? '—') : '—'}
            tone={smsEnabled ? 'sage' : 'muted'}
          />
          <PreviewStat
            label={t('marketing.compose.preview_can_email')}
            value={canPreview && emailEnabled ? (preview.data?.can_email ?? '—') : '—'}
            tone={emailEnabled ? 'sage' : 'muted'}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canPreview || (preview.data?.eligible ?? 0) === 0}
            size="lg"
          >
            <Send className="size-4" strokeWidth={2} />
            {t('marketing.compose.send_button')}
          </Button>
        </div>
      </section>

      {/* ----------- Confirm modal (минимальный inline) ----------- */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => !send.isPending && setConfirmOpen(false)}
        >
          <div
            className="bg-card shadow-finmd w-full max-w-md rounded-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-brand-navy text-base font-bold tracking-tight">
              {t('marketing.compose.confirm_title')}
            </h3>
            <p className="text-muted-foreground mt-2 text-sm">
              {t('marketing.compose.confirm_body', {
                eligible: preview.data?.eligible ?? 0,
                sms: smsEnabled ? (preview.data?.can_sms ?? 0) : 0,
                email: emailEnabled ? (preview.data?.can_email ?? 0) : 0,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={send.isPending}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSend} disabled={send.isPending}>
                {send.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" strokeWidth={2} />
                )}
                {t('marketing.compose.confirm_send_button')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SegmentPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-3 py-2 text-sm font-semibold transition-colors',
        active
          ? 'border-brand-sage bg-brand-sage-soft/40 text-brand-sage-deep'
          : 'border-border bg-card text-muted-foreground hover:border-brand-sage/40',
      )}
    >
      {label}
    </button>
  )
}

function ChannelToggleBig({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Mail
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2 rounded-md border p-3 text-base font-semibold transition-colors',
        active
          ? 'border-brand-sage bg-brand-sage-soft/30 text-brand-sage-deep'
          : 'border-border bg-card text-muted-foreground hover:border-brand-sage/40',
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
      {label}
    </button>
  )
}

function PreviewStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'sage' | 'muted'
}) {
  return (
    <div className="bg-card border-border/40 rounded-md border p-3">
      <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">{label}</p>
      <p
        className={cn(
          'num mt-1 text-xl font-bold tracking-tight',
          tone === 'sage' ? 'text-brand-sage-deep' : 'text-brand-navy',
          tone === 'muted' ? 'text-muted-foreground/60' : '',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * Селект тега клиента: тянем уникальные теги по всем клиентам салона + опция
 * для свободного ввода (если нужного тега ещё нет в системе).
 */
function TagSelect({
  salonId,
  value,
  onChange,
  disabled,
}: {
  salonId: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { data: clients = [] } = useClients(salonId, { search: '', sort: 'name' })
  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const c of clients) {
      for (const tag of c.tags ?? []) {
        const tr = tag.trim()
        if (tr) set.add(tr)
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [clients])

  // Если value не пустое и его нет в tags — добавим как «свой тег» в начало
  // списка, чтобы юзер видел свой выбор.
  const options = useMemo(() => {
    if (value && !tags.includes(value)) return [value, ...tags]
    return tags
  }, [value, tags])

  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => onChange(v)}
      disabled={disabled || tags.length === 0}
    >
      <SelectTrigger className="max-w-[260px]">
        <SelectValue
          placeholder={
            tags.length === 0
              ? t('marketing.compose.tag_no_tags')
              : t('marketing.compose.tag_placeholder')
          }
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((tag) => (
          <SelectItem key={tag} value={tag}>
            {tag}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
