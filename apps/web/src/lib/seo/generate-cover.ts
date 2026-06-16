/**
 * Авто-генерация брендовой обложки статьи прямо в браузере (canvas → PNG).
 *
 * Без внешних платных API (никакого DALL-E / Unsplash-ключа): рисуем
 * фирменную карточку 1200×630 (OG-формат) с градиентом в цветах бренда,
 * заголовком и вордмарком. Используется кнопкой «Сгенерировать статью
 * целиком» в админке /admin/media, чтобы у статьи сразу была обложка
 * (для og:image и SEO-чека «Обложка»).
 */

const OG_W = 1200
const OG_H = 630

type CoverOpts = {
  /** Крупный текст (заголовок статьи или ключ). */
  title: string
  /** Маленькая надпись сверху (eyebrow). */
  eyebrow?: string
  /** 'cover' — тёмно-синий → бирюза; 'inline' — бирюза → тёмно-синий. */
  variant?: 'cover' | 'inline'
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current)
      current = word
      if (lines.length === maxLines - 1) break
    } else {
      current = candidate
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  // Если текст не влез — добавляем многоточие к последней строке.
  const used = lines.join(' ').split(/\s+/).filter(Boolean).length
  if (used < words.length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]!}…`
  }
  return lines
}

/**
 * Рисует брендовую карточку и возвращает PNG-Blob 1200×630.
 * Шрифты ждём через document.fonts.ready, иначе canvas нарисует fallback.
 */
export async function renderBrandedCover(opts: CoverOpts): Promise<Blob> {
  const { title, eyebrow = 'FINKLEY · БЛОГ', variant = 'cover' } = opts

  try {
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      await document.fonts.ready
    }
  } catch {
    /* font loading best-effort */
  }

  const canvas = document.createElement('canvas')
  canvas.width = OG_W
  canvas.height = OG_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_2d_unavailable')

  // Фон-градиент в цветах бренда (navy ↔ teal).
  const navy = '#13243B'
  const teal = '#0E7C86'
  const gold = '#E7B23C'
  const grad = ctx.createLinearGradient(0, 0, OG_W, OG_H)
  if (variant === 'inline') {
    grad.addColorStop(0, teal)
    grad.addColorStop(1, navy)
  } else {
    grad.addColorStop(0, navy)
    grad.addColorStop(1, teal)
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, OG_W, OG_H)

  const font = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
  const PAD = 88

  // Eyebrow.
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = `700 28px ${font}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(eyebrow.toUpperCase().slice(0, 42), PAD, 118)

  // Золотой акцент-бар.
  ctx.fillStyle = gold
  ctx.fillRect(PAD, 142, 96, 10)

  // Заголовок (перенос строк).
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `800 66px ${font}`
  const lines = wrapLines(ctx, title, OG_W - PAD * 2, 5)
  const lineHeight = 80
  let y = 250
  for (const line of lines) {
    ctx.fillText(line, PAD, y)
    y += lineHeight
  }

  // Вордмарк внизу.
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = `800 34px ${font}`
  ctx.fillText('finkley', PAD, OG_H - 56)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas_toblob_failed'))),
      'image/png',
      0.92,
    )
  })
}
