import html2canvas from 'html2canvas-pro'
import { Camera, Loader2, Paperclip, Send, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase/client'

/**
 * Модалка «Сообщить о баге» для тестировщиков.
 *
 * Поля:
 *  - Описание (textarea, required)
 *  - Прикрепить файл/фото (input type=file)
 *  - «Сделать скрин» — временно скрывает модалку, открывает overlay для
 *    выделения области (см. AreaScreenshotPicker), рендерит только эту
 *    область через html2canvas → возвращает data-URL в модалку
 *  - «Отправить баг» → POST /functions/v1/tester-bug-report
 *
 * После отправки toast «Спасибо!» + модалка закрывается.
 */
export function TesterBugModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [description, setDescription] = useState('')
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<{
    data_url: string
    mime: string
    name: string
  } | null>(null)
  const [picking, setPicking] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('tester.modal.error_file_too_large'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setAttachment({
        data_url: result,
        mime: file.type || 'application/octet-stream',
        name: file.name,
      })
    }
    reader.readAsDataURL(file)
  }

  async function startAreaScreenshot() {
    setPicking(true)
    // Прячем модалку и баннер на время выделения
    document.documentElement.classList.add('tester-screenshot-mode')
    const rect = await pickArea()
    document.documentElement.classList.remove('tester-screenshot-mode')

    if (!rect) {
      setPicking(false)
      return
    }
    try {
      // Рендерим всю страницу в canvas через html2canvas, потом обрезаем по rect.
      // html2canvas-pro поддерживает современные CSS color() — без него ломается
      // на oklch/lab переменных Tailwind.
      const fullCanvas = await html2canvas(document.body, {
        backgroundColor: '#ffffff',
        useCORS: true,
        scale: Math.min(2, window.devicePixelRatio || 1),
      })
      const scale = fullCanvas.width / document.documentElement.clientWidth
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = Math.max(1, Math.round(rect.w * scale))
      cropCanvas.height = Math.max(1, Math.round(rect.h * scale))
      const ctx = cropCanvas.getContext('2d')!
      ctx.drawImage(
        fullCanvas,
        Math.round((rect.x + window.scrollX) * scale),
        Math.round((rect.y + window.scrollY) * scale),
        Math.round(rect.w * scale),
        Math.round(rect.h * scale),
        0,
        0,
        cropCanvas.width,
        cropCanvas.height,
      )
      setScreenshot(cropCanvas.toDataURL('image/png'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setPicking(false)
    }
  }

  async function submit() {
    if (!description.trim()) {
      toast.error(t('tester.modal.error_description_required'))
      return
    }
    setSubmitting(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('not_authenticated')
      const baseUrl = import.meta.env.VITE_SUPABASE_URL
      // Если тестер находится в кабинете салона (/{salon_id}/...) — привязываем
      // баг к этому салону для удобства поиска в /admin/feedback.
      const salonIdMatch = window.location.pathname.match(
        /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i,
      )
      const salonId = salonIdMatch?.[1] ?? null

      const r = await fetch(`${baseUrl}/functions/v1/tester-bug-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          description,
          screenshot_base64: screenshot,
          attachment_base64: attachment?.data_url,
          attachment_mime: attachment?.mime,
          attachment_name: attachment?.name,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
          salon_id: salonId,
        }),
      })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `HTTP ${r.status}`)
      }
      toast.success(t('tester.modal.toast_sent'))
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!picking} onOpenChange={(v) => !v && !picking && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tester.modal.title')}</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-4">
          <Label htmlFor="tester-desc" className="text-xs">
            {t('tester.modal.description_label')}
          </Label>
          <textarea
            id="tester-desc"
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder={t('tester.modal.description_placeholder')}
            className="border-border bg-card focus-visible:ring-ring mt-1 block w-full rounded-md border p-2.5 text-sm focus-visible:outline-none focus-visible:ring-2"
          />

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="border-border hover:bg-muted/40 inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-semibold">
              <Paperclip className="size-3.5" strokeWidth={1.8} />
              {attachment ? t('tester.modal.attachment_replace') : t('tester.modal.attach_file')}
              <input
                type="file"
                accept="image/*,application/pdf,video/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
            <Button variant="outline" size="md" onClick={startAreaScreenshot} disabled={picking}>
              <Camera className="size-3.5" strokeWidth={1.8} />
              {screenshot ? t('tester.modal.screenshot_retake') : t('tester.modal.take_screenshot')}
            </Button>
          </div>

          {screenshot ? (
            <div className="border-border relative mt-3 overflow-hidden rounded-md border">
              <img src={screenshot} alt="screenshot" className="max-h-48 w-full object-contain" />
              <button
                type="button"
                onClick={() => setScreenshot(null)}
                className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                aria-label="remove screenshot"
              >
                <X className="size-3" strokeWidth={2.5} />
              </button>
            </div>
          ) : null}
          {attachment ? (
            <div className="border-border mt-3 flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
              <span className="truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Send className="size-3.5" strokeWidth={2} />
            )}
            {t('tester.modal.send')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Overlay для выделения прямоугольной области мышью. Возвращает координаты
 * относительно viewport. Скрывается через `tester-screenshot-mode` класс
 * на html (см. CSS в globals.css).
 */
function pickArea(): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.25); cursor: crosshair;
      user-select: none;
    `
    const rect = document.createElement('div')
    rect.style.cssText = `
      position: absolute; border: 2px solid #f59e0b;
      background: rgba(245,158,11,0.15); pointer-events: none;
    `
    overlay.appendChild(rect)

    const hint = document.createElement('div')
    hint.textContent = 'Выделите область для скриншота — мышью. ESC чтобы отменить.'
    hint.style.cssText = `
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.85); color: white; padding: 6px 12px;
      border-radius: 999px; font-size: 12px; pointer-events: none;
      font-family: ui-sans-serif, system-ui, sans-serif;
    `
    overlay.appendChild(hint)
    document.body.appendChild(overlay)

    let startX = 0
    let startY = 0
    let dragging = false

    function cleanup() {
      overlay.removeEventListener('mousedown', onMouseDown)
      overlay.removeEventListener('mousemove', onMouseMove)
      overlay.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKey)
      overlay.remove()
    }

    function onMouseDown(e: MouseEvent) {
      dragging = true
      startX = e.clientX
      startY = e.clientY
      rect.style.left = `${startX}px`
      rect.style.top = `${startY}px`
      rect.style.width = '0'
      rect.style.height = '0'
    }
    function onMouseMove(e: MouseEvent) {
      if (!dragging) return
      const x = Math.min(startX, e.clientX)
      const y = Math.min(startY, e.clientY)
      const w = Math.abs(e.clientX - startX)
      const h = Math.abs(e.clientY - startY)
      rect.style.left = `${x}px`
      rect.style.top = `${y}px`
      rect.style.width = `${w}px`
      rect.style.height = `${h}px`
    }
    function onMouseUp(e: MouseEvent) {
      if (!dragging) return
      dragging = false
      const x = Math.min(startX, e.clientX)
      const y = Math.min(startY, e.clientY)
      const w = Math.abs(e.clientX - startX)
      const h = Math.abs(e.clientY - startY)
      cleanup()
      if (w < 10 || h < 10) {
        resolve(null) // случайный клик — отмена
        return
      }
      resolve({ x, y, w, h })
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cleanup()
        resolve(null)
      }
    }

    overlay.addEventListener('mousedown', onMouseDown)
    overlay.addEventListener('mousemove', onMouseMove)
    overlay.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKey)
  })
}
