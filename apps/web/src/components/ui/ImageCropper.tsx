import { Loader2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * Модалка для кадрирования изображения. Используется при загрузке аватара
 * (aspect=1) и логотипа салона (aspect=null — свободный).
 *
 * UX:
 *   - Изображение вписывается в canvas с фиксированными размерами.
 *   - Drag — перемещение, scroll/buttons — zoom.
 *   - Crop frame — фиксированной формы (квадрат для аватара, прямоугольник
 *     для логотипа) с outline, остальное затемнено.
 *   - Output: canvas.toBlob, max 512px по большей стороне → webp.
 *
 * Не зависит от внешних библиотек — нативный canvas + DOM events.
 */

type Props = {
  /** Source file для кропа. Если null — модалка закрыта. */
  file: File | null
  /** 1 — квадрат (аватар), 16/9 — landscape, null — свободно (логотип). */
  aspect?: number | null
  /** Максимальный размер выходного изображения в пикселях по большей стороне. */
  maxOutputSize?: number
  /** MIME type выходного изображения. По умолчанию image/webp (компактно). */
  outputMime?: string
  /** Качество jpeg/webp 0..1. По умолчанию 0.9. */
  outputQuality?: number
  onCancel: () => void
  onCrop: (blob: Blob) => void | Promise<void>
}

export function ImageCropper({
  file,
  aspect = 1,
  maxOutputSize = 512,
  outputMime = 'image/webp',
  outputQuality = 0.9,
  onCancel,
  onCrop,
}: Props) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // State: переменные «вид камеры» — масштаб + смещения. Crop frame фикс.
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  // Drag tracking.
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // Размер canvas-stage (квадрат для крайних случаев — больше всех нужных).
  const STAGE = 360
  // Размер crop frame (внутри stage). Для aspect=1 квадрат CROP×CROP.
  // Для свободного aspect (логотип) делаем frame чуть меньше stage.
  const CROP_W =
    aspect == null
      ? Math.round(STAGE * 0.9)
      : aspect >= 1
        ? STAGE - 32
        : Math.round((STAGE - 32) * aspect)
  const CROP_H =
    aspect == null
      ? Math.round(STAGE * 0.9)
      : aspect >= 1
        ? Math.round((STAGE - 32) / aspect)
        : STAGE - 32
  const CROP_X = (STAGE - CROP_W) / 2
  const CROP_Y = (STAGE - CROP_H) / 2

  // Загружаем картинку.
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      // Начальный scale — чтобы изображение полностью покрывало crop frame.
      const sX = CROP_W / img.naturalWidth
      const sY = CROP_H / img.naturalHeight
      const initialScale = Math.max(sX, sY)
      setScale(initialScale)
      setTx(STAGE / 2 - (img.naturalWidth * initialScale) / 2)
      setTy(STAGE / 2 - (img.naturalHeight * initialScale) / 2)
      setImgLoaded(true)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file, CROP_W, CROP_H])

  // Render — рисуем картинку, затемняем зону вне frame, рисуем рамку.
  useEffect(() => {
    if (!imgLoaded) return
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, STAGE, STAGE)
    // Картинка.
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    ctx.restore()
    // Затемнение вне crop frame: рисуем mask с evenodd.
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.rect(0, 0, STAGE, STAGE)
    ctx.rect(CROP_X, CROP_Y, CROP_W, CROP_H)
    ctx.fill('evenodd')
    // Рамка.
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.strokeRect(CROP_X, CROP_Y, CROP_W, CROP_H)
  }, [imgLoaded, scale, tx, ty, CROP_X, CROP_Y, CROP_W, CROP_H])

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    setTx(dragRef.current.tx + dx)
    setTy(dragRef.current.ty + dy)
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }
  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const delta = -e.deltaY * 0.002
    setScale((s) => Math.max(0.1, Math.min(5, s * (1 + delta))))
  }
  function zoomBy(factor: number) {
    setScale((s) => Math.max(0.1, Math.min(5, s * factor)))
  }

  async function applyCrop() {
    const img = imgRef.current
    if (!img) return
    // Финальный canvas: размер crop frame × scaling до maxOutputSize.
    const outScale = Math.min(1, maxOutputSize / Math.max(CROP_W, CROP_H))
    const outW = Math.round(CROP_W * outScale)
    const outH = Math.round(CROP_H * outScale)
    const outCanvas = document.createElement('canvas')
    outCanvas.width = outW
    outCanvas.height = outH
    const outCtx = outCanvas.getContext('2d')
    if (!outCtx) return
    // Маппинг crop-зоны на исходное изображение: (CROP_X - tx) / scale,
    // (CROP_Y - ty) / scale, размер CROP_W / scale × CROP_H / scale.
    const srcX = (CROP_X - tx) / scale
    const srcY = (CROP_Y - ty) / scale
    const srcW = CROP_W / scale
    const srcH = CROP_H / scale
    outCtx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH)
    setSubmitting(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        outCanvas.toBlob(resolve, outputMime, outputQuality),
      )
      if (!blob) throw new Error('crop_failed')
      await onCrop(blob)
    } finally {
      setSubmitting(false)
    }
  }

  if (!file) return null

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md p-0">
        <DialogTitle className="border-border flex items-center justify-between border-b px-5 py-3 text-base font-bold">
          {t('cropper.title', { defaultValue: 'Обрезать изображение' })}
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </DialogTitle>
        <div className="flex flex-col items-center gap-3 p-5">
          <canvas
            ref={canvasRef}
            width={STAGE}
            height={STAGE}
            style={{ cursor: dragRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
            className="border-border rounded-md border bg-neutral-100"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => zoomBy(1 / 1.2)}>
              <ZoomOut className="size-4" strokeWidth={2} />
            </Button>
            <span className="text-muted-foreground w-12 text-center text-xs tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => zoomBy(1.2)}>
              <ZoomIn className="size-4" strokeWidth={2} />
            </Button>
          </div>
          <p className="text-muted-foreground text-center text-[11px]">
            {t('cropper.hint', {
              defaultValue: 'Перетащи изображение чтобы выровнять. Колесо мыши — масштаб.',
            })}
          </p>
        </div>
        <div className="border-border flex items-center justify-end gap-2 border-t bg-white px-5 py-3">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {t('common.cancel', { defaultValue: 'Отменить' })}
          </Button>
          <Button type="button" onClick={applyCrop} disabled={submitting || !imgLoaded}>
            {submitting ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
            {t('cropper.apply', { defaultValue: 'Сохранить' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
