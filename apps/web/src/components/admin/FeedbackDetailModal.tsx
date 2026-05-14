import {
  Bug,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Lightbulb,
  Mail,
  Phone,
  Send,
  ShieldAlert,
  User2,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useFeedbackApprove,
  useFeedbackAttachments,
  useFeedbackReject,
  useFeedbackStatus,
  type AdminFeedbackRow,
} from '@/hooks/useAdmin'

const STATUS_TONE: Record<string, string> = {
  open: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-amber-100 text-amber-800',
  fixed: 'bg-emerald-100 text-emerald-700',
  wontfix: 'bg-slate-100 text-slate-600',
  duplicate: 'bg-slate-100 text-slate-600',
}

/**
 * Модалка с полными деталями бага: описание, AI-summary, notes, attachments
 * (изображения в lightbox-карусели, документы — кнопкой download). Открывается
 * по клику на строку в /admin/feedback.
 */
export function FeedbackDetailModal({
  row,
  onClose,
}: {
  row: AdminFeedbackRow
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { data: atts, isLoading: loadingAtts } = useFeedbackAttachments(row.id)
  const approve = useFeedbackApprove()
  const reject = useFeedbackReject()
  const status = useFeedbackStatus()

  const isPendingApproval = row.requires_approval && !row.approved_at
  const KindIcon = row.kind === 'feature' ? Lightbulb : Bug
  const SourceIcon = row.source === 'client' ? User2 : row.source === 'tester' ? ShieldAlert : Users

  // Lightbox state — карусель изображений
  const images = (atts?.attachments ?? []).filter(
    (a) => (a.mime ?? '').startsWith('image/') && a.signed_url,
  )
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  useEffect(() => {
    if (lightboxIdx === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxIdx(null)
      if (e.key === 'ArrowLeft')
        setLightboxIdx((i) => (i === null ? null : (i - 1 + images.length) % images.length))
      if (e.key === 'ArrowRight')
        setLightboxIdx((i) => (i === null ? null : (i + 1) % images.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, images.length])

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:!w-[640px] sm:!max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KindIcon
                className={`size-4 shrink-0 ${row.kind === 'feature' ? 'text-amber-600' : 'text-rose-600'}`}
                strokeWidth={2}
              />
              <span className="truncate">
                {row.kind === 'feature'
                  ? t('admin.feedback.kind.feature')
                  : t('admin.feedback.kind.bug')}{' '}
                · {new Date(row.reported_at).toLocaleString('ru-RU')}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {/* Чипы */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={[
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                  row.source === 'client'
                    ? 'bg-amber-100 text-amber-800'
                    : row.source === 'tester'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-700',
                ].join(' ')}
              >
                <SourceIcon className="size-3" strokeWidth={2} />
                {t(`admin.feedback.source.${row.source}`)}
              </span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[row.status] ?? 'bg-slate-100 text-slate-700'}`}
              >
                {t(`admin.feedback.status.${row.status}`)}
              </span>
              {isPendingApproval ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                  <ShieldAlert className="size-3" strokeWidth={2} />
                  {t('admin.feedback.pending_approval')}
                </span>
              ) : null}
              {row.severity ? (
                <span className="bg-muted/60 text-foreground inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                  {row.severity}
                </span>
              ) : null}
              {row.area ? (
                <span className="bg-muted/60 text-foreground inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                  {row.area}
                </span>
              ) : null}
            </div>

            {/* Reporter — карточка отправителя */}
            <section className="border-border rounded-md border bg-slate-50/50 p-3">
              <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
                {t('admin.feedback.detail.reporter')}
              </h3>
              <p className="text-foreground text-sm font-semibold">
                {row.reporter_full_name ?? row.sender_first_name ?? '—'}
              </p>
              <div className="mt-1.5 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                {row.reporter_email ? (
                  <div className="text-muted-foreground inline-flex items-center gap-1.5">
                    <Mail className="size-3.5" strokeWidth={1.8} />
                    <a
                      href={`mailto:${row.reporter_email}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {row.reporter_email}
                    </a>
                  </div>
                ) : null}
                {row.reporter_phone ? (
                  <div className="text-muted-foreground inline-flex items-center gap-1.5">
                    <Phone className="size-3.5" strokeWidth={1.8} />
                    <a
                      href={`tel:${row.reporter_phone}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {row.reporter_phone}
                    </a>
                  </div>
                ) : null}
                {row.reporter_telegram ? (
                  <div className="text-muted-foreground inline-flex items-center gap-1.5">
                    <Send className="size-3.5" strokeWidth={1.8} />
                    <a
                      href={`https://t.me/${row.reporter_telegram}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground hover:underline"
                    >
                      @{row.reporter_telegram}
                    </a>
                  </div>
                ) : row.sender_username ? (
                  <div className="text-muted-foreground inline-flex items-center gap-1.5">
                    <Send className="size-3.5" strokeWidth={1.8} />
                    <a
                      href={`https://t.me/${row.sender_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground hover:underline"
                    >
                      @{row.sender_username}
                    </a>
                  </div>
                ) : null}
              </div>

              {/* Салоны: либо явно привязанный к багу (row.salon_name), либо все
                  салоны отправителя из salon_members (когда не указан конкретный) */}
              {row.salon_name || row.reporter_salons.length > 0 ? (
                <div className="border-border mt-3 border-t pt-2">
                  <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold uppercase">
                    {t('admin.feedback.detail.salon')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {row.salon_id && row.salon_name ? (
                      <Link
                        to={`/${row.salon_id}/dashboard`}
                        className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold"
                      >
                        <Building2 className="size-3" strokeWidth={2} />
                        {row.salon_name}
                      </Link>
                    ) : (
                      row.reporter_salons.map((s) => (
                        <Link
                          key={s.salon_id}
                          to={`/${s.salon_id}/dashboard`}
                          className="bg-muted/60 hover:bg-muted text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold"
                          title={t(`roles.${s.role}`, { defaultValue: s.role })}
                        >
                          <Building2 className="size-3" strokeWidth={2} />
                          {s.salon_name}
                          <span className="text-muted-foreground ml-1 text-[9px] uppercase">
                            {t(`roles.${s.role}`, { defaultValue: s.role })}
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            {/* Описание */}
            <section>
              <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
                {t('admin.feedback.detail.message')}
              </h3>
              <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                {row.message_text || '—'}
              </p>
            </section>

            {/* AI summary */}
            {row.ai_summary ? (
              <section className="bg-muted/40 border-border rounded-md border p-3">
                <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
                  {t('admin.feedback.detail.ai_summary')}
                </h3>
                <p className="text-foreground whitespace-pre-wrap text-sm">{row.ai_summary}</p>
              </section>
            ) : null}

            {/* Notes */}
            {row.notes ? (
              <section>
                <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
                  {t('admin.feedback.detail.notes')}
                </h3>
                <p className="text-foreground whitespace-pre-wrap text-xs">{row.notes}</p>
              </section>
            ) : null}

            {/* Attachments */}
            <section>
              <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
                {t('admin.feedback.detail.attachments', { count: atts?.attachments?.length ?? 0 })}
              </h3>
              {loadingAtts ? (
                <p className="text-muted-foreground text-xs">{t('common.loading')}</p>
              ) : !atts || atts.attachments.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t('admin.feedback.detail.no_attachments')}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {atts.attachments.map((a, i) => {
                    const isImage = (a.mime ?? '').startsWith('image/')
                    if (isImage && a.signed_url) {
                      const imgIdx = images.findIndex((x) => x.signed_url === a.signed_url)
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setLightboxIdx(imgIdx >= 0 ? imgIdx : 0)}
                          className="border-border bg-muted/30 group relative aspect-square overflow-hidden rounded-md border"
                        >
                          <img
                            src={a.signed_url}
                            alt={a.name ?? 'attachment'}
                            className="size-full object-cover transition-transform group-hover:scale-105"
                          />
                        </button>
                      )
                    }
                    return (
                      <a
                        key={i}
                        href={a.signed_url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (!a.signed_url) {
                            e.preventDefault()
                            toast.error(t('admin.feedback.detail.error_no_url'))
                          }
                        }}
                        className="border-border hover:bg-muted/40 flex aspect-square flex-col items-center justify-center gap-1 rounded-md border p-2 text-center text-[10px]"
                      >
                        <FileText className="text-muted-foreground size-6" strokeWidth={1.6} />
                        <span className="text-muted-foreground line-clamp-2 break-all">
                          {a.name ?? a.mime ?? 'file'}
                        </span>
                      </a>
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Footer actions */}
          <div className="border-border flex flex-wrap items-center gap-2 border-t px-5 py-3">
            {isPendingApproval ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    approve.mutate(
                      { id: row.id },
                      {
                        onSuccess: () => {
                          toast.success(t('admin.feedback.toast.approved'))
                          onClose()
                        },
                        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                      },
                    )
                  }
                >
                  {t('admin.feedback.action.approve')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    reject.mutate(
                      { id: row.id },
                      {
                        onSuccess: () => {
                          toast.success(t('admin.feedback.toast.rejected'))
                          onClose()
                        },
                        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                      },
                    )
                  }
                >
                  {t('admin.feedback.action.reject')}
                </Button>
              </>
            ) : (
              <select
                value={row.status}
                onChange={(e) =>
                  status.mutate(
                    { id: row.id, status: e.target.value },
                    {
                      onSuccess: () => toast.success(t('admin.feedback.toast.status_updated')),
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : String(err)),
                    },
                  )
                }
                className="border-border bg-card h-9 rounded-md border px-2 text-sm"
              >
                <option value="open">{t('admin.feedback.status.open')}</option>
                <option value="in_progress">{t('admin.feedback.status.in_progress')}</option>
                <option value="fixed">{t('admin.feedback.status.fixed')}</option>
                <option value="wontfix">{t('admin.feedback.status.wontfix')}</option>
                <option value="duplicate">{t('admin.feedback.status.duplicate')}</option>
              </select>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightboxIdx !== null && images[lightboxIdx] ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation()
              setLightboxIdx(null)
            }}
            aria-label="close"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                className="absolute left-4 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightboxIdx((i) =>
                    i === null ? null : (i - 1 + images.length) % images.length,
                  )
                }}
                aria-label="prev"
              >
                <ChevronLeft className="size-6" strokeWidth={2} />
              </button>
              <button
                type="button"
                className="absolute right-4 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightboxIdx((i) => (i === null ? null : (i + 1) % images.length))
                }}
                aria-label="next"
              >
                <ChevronRight className="size-6" strokeWidth={2} />
              </button>
            </>
          ) : null}
          <img
            src={images[lightboxIdx].signed_url!}
            alt={images[lightboxIdx].name ?? 'attachment'}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white/10 px-4 py-1.5 text-xs text-white">
            <span>
              {lightboxIdx + 1} / {images.length}
            </span>
            <a
              href={images[lightboxIdx].signed_url!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 hover:underline"
            >
              <ExternalLink className="size-3" strokeWidth={2} /> open
            </a>
            <a
              href={images[lightboxIdx].signed_url!}
              download={images[lightboxIdx].name ?? 'attachment'}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 hover:underline"
            >
              <Download className="size-3" strokeWidth={2} /> download
            </a>
          </div>
        </div>
      ) : null}
    </>
  )
}
