import { Camera, Check, FileImage, Loader2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

export type ParsedVisit = {
  date?: string | null
  client_name?: string | null
  service?: string | null
  amount?: number | null
  master?: string | null
  raw?: string | null
}

/**
 * T102 — кнопка «Загрузить фото блокнота» в онбординге.
 *
 * Юзер фотографирует страницу блокнота → AI распознаёт → показываем
 * список визитов с возможностью отметить какие импортировать.
 *
 * В онбординге salon_id ещё нет — кнопка disabled с подсказкой
 * «доступно после создания салона». Сохраняем выбранные визиты в state,
 * после submit'a импортируем как обычные visits.
 *
 * После создания салона (на дашборде/в /income/visits) можно вызывать
 * без disabled state — передавая salonId.
 */
export function OcrNotebookButton({
  salonId,
  onVisitsParsed,
}: {
  salonId: string | null
  onVisitsParsed: (visits: ParsedVisit[]) => void
}) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<ParsedVisit[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => {
        const result = String(r.result)
        // dataUrl → только base64 часть
        const base64 = result.split(',')[1] ?? result
        resolve(base64)
      }
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  }

  async function handleFile(file: File) {
    if (!salonId) {
      toast.error(
        t('onboarding.ocr.no_salon', {
          defaultValue: 'Доступно после создания салона. Сначала пройди до Финиша.',
        }),
      )
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error(t('onboarding.ocr.too_large', { defaultValue: 'Макс. 4 МБ' }))
      return
    }
    setLoading(true)
    try {
      const base64 = await blobToBase64(file)
      const { data, error } = await supabase.functions.invoke('ocr-notebook', {
        body: { image_base64: base64, salon_id: salonId },
      })
      if (error) throw error
      const res = data as { visits?: ParsedVisit[]; error?: string }
      if (res.error || !res.visits) throw new Error(res.error ?? 'no_visits')
      setPreview(res.visits)
      setSelected(new Set(res.visits.map((_, i) => i)))
      toast.success(
        t('onboarding.ocr.toast_done', {
          defaultValue: 'Распознано визитов: {{count}}',
          count: res.visits.length,
        }),
      )
    } catch (e) {
      toast.error(
        t('onboarding.ocr.toast_fail', {
          defaultValue: 'Не получилось распознать: {{msg}}',
          msg: e instanceof Error ? e.message : String(e),
        }),
      )
    } finally {
      setLoading(false)
    }
  }

  function confirm() {
    if (!preview) return
    const picked = preview.filter((_, i) => selected.has(i))
    onVisitsParsed(picked)
    setPreview(null)
    setSelected(new Set())
    toast.success(
      t('onboarding.ocr.toast_imported', {
        defaultValue: 'Добавлено визитов: {{count}} — импортируем после создания салона.',
        count: picked.length,
      }),
    )
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className={cn(
          'border-brand-teal-deep bg-brand-teal-soft/30 hover:bg-brand-teal-soft/50 text-brand-teal-deep inline-flex items-center gap-2 rounded-lg border-2 px-4 py-2.5 text-sm font-bold transition-colors',
          loading && 'cursor-wait opacity-60',
        )}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={2} />
        ) : (
          <Camera className="size-4" strokeWidth={2} />
        )}
        {loading
          ? t('onboarding.ocr.loading', { defaultValue: 'AI читает страницу…' })
          : t('onboarding.ocr.upload', { defaultValue: '📷 Сфотографировать страницу блокнота' })}
      </button>

      {/* Preview list */}
      {preview ? (
        <div className="border-border bg-card mt-3 rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
              <FileImage className="text-brand-teal-deep size-4" strokeWidth={2} />
              {t('onboarding.ocr.preview_title', {
                defaultValue: 'AI распознал — отметь что импортировать',
              })}
            </p>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="close"
            >
              <X className="size-4" strokeWidth={1.7} />
            </button>
          </div>

          {preview.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('onboarding.ocr.empty', {
                defaultValue: 'Ничего не распознано на этой странице.',
              })}
            </p>
          ) : (
            <div className="flex max-h-60 flex-col gap-1.5 overflow-auto">
              {preview.map((v, i) => {
                const checked = selected.has(i)
                return (
                  <label
                    key={i}
                    className={cn(
                      'border-border bg-muted/20 hover:bg-muted/40 flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs',
                      checked && 'border-brand-teal-deep bg-brand-teal-soft/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(selected)
                        if (e.target.checked) next.add(i)
                        else next.delete(i)
                        setSelected(next)
                      }}
                      className="accent-brand-teal-deep mt-0.5 size-3.5 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground font-semibold">
                        {[v.date, v.client_name].filter(Boolean).join(' · ') || v.raw || '—'}
                      </p>
                      <p className="text-muted-foreground mt-0.5">
                        {[v.service, v.amount != null ? `${v.amount}` : null, v.master]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          )}

          {preview.length > 0 ? (
            <button
              type="button"
              onClick={confirm}
              className="bg-brand-teal-deep hover:bg-brand-teal-deep/90 mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold text-white"
            >
              <Check className="size-3.5" strokeWidth={2.4} />
              {t('onboarding.ocr.import', {
                defaultValue: 'Добавить выбранные ({{count}})',
                count: selected.size,
              })}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
