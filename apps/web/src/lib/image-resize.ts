/**
 * Уменьшает изображение до максимального размера {maxDim} по большей стороне
 * и конвертирует в JPEG с указанным качеством. Используется перед отправкой
 * фото в AI-функции (ocr-notebook, фото чеков), чтобы влезать в лимиты Claude
 * и Supabase Edge Function.
 *
 * Bug 26088b7f: фото блокнота >3MB base64 валились в edge function. Сжимаем
 * до ~1MB на клиенте, AI всё равно хватает.
 */
export async function resizeImageToJpeg(
  file: File | Blob,
  maxDim = 1600,
  quality = 0.85,
): Promise<Blob> {
  const dataUrl = await blobToDataUrl(file)
  const img = await loadImage(dataUrl)
  const { width, height } = scaleDown(img.width, img.height, maxDim)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_unsupported')
  ctx.drawImage(img, 0, 0, width, height)

  return await canvasToBlob(canvas, 'image/jpeg', quality)
}

function scaleDown(w: number, h: number, maxDim: number) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h }
  const scale = maxDim / Math.max(w, h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image_decode_failed'))
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('canvas_to_blob_failed'))
        else resolve(blob)
      },
      mime,
      quality,
    )
  })
}
