/**
 * SEO-утилиты для админки блога: вычисление score, плотность ключевых слов,
 * автогенерация slug, чек-лист проблем.
 */

export type SeoInput = {
  title: string
  description: string
  body_html: string
  seo_title?: string | null
  seo_description?: string | null
  og_image_url?: string | null
  cover_url?: string | null
  keywords?: string[] | null
  tags?: string[] | null
  target_keyword?: string
  slug: string
}

export type SeoCheck = {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  hint?: string
  weight: number
}

export type SeoResult = {
  score: number
  checks: SeoCheck[]
  wordCount: number
  readingMinutes: number
  density: number
  densityVerdict: 'low' | 'good' | 'high'
}

/** Stripped plain text из HTML — для подсчёта слов / плотности. */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  // Удаляем теги, нормализуем пробелы.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function countWords(text: string): number {
  if (!text) return 0
  const m = text.match(/[\p{L}\p{N}]+/gu)
  return m?.length ?? 0
}

/** Плотность keyword в %. Считается по plain text body. */
export function keywordDensity(text: string, keyword: string): number {
  if (!keyword.trim() || !text.trim()) return 0
  const total = countWords(text)
  if (total === 0) return 0
  const kw = keyword.toLowerCase().trim()
  const t = text.toLowerCase()
  // Простой подсчёт: разбиваем text на слова, ищем подстроку (для multi-word
  // keyword использовать regex). Этого достаточно для feedback внутри админки.
  let count = 0
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b${escaped}\\b`, 'gi')
  const matches = t.match(re)
  if (matches) count = matches.length
  return (count / total) * 100
}

/** Автогенерация slug из заголовка: транслитерация ru → ascii. */
export function slugify(title: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }
  return title
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

export function evaluateSeo(input: SeoInput): SeoResult {
  const plain = htmlToPlainText(input.body_html)
  const wordCount = countWords(plain)
  const readingMinutes = Math.max(1, Math.round(wordCount / 200))

  const effectiveTitle = (input.seo_title ?? input.title ?? '').trim()
  const effectiveDesc = (input.seo_description ?? input.description ?? '').trim()
  const cover = input.og_image_url ?? input.cover_url ?? null
  const keywords = (input.keywords ?? input.tags ?? []).filter(Boolean)

  const target = (input.target_keyword ?? '').trim()
  const density = target ? keywordDensity(plain, target) : 0
  const densityVerdict: SeoResult['densityVerdict'] =
    density === 0 ? 'low' : density < 0.5 ? 'low' : density > 3 ? 'high' : 'good'

  // H1 count
  const h1Matches = (input.body_html.match(/<h1\b/gi) ?? []).length
  // H2 count — наличие хотя бы 2 H2 = хорошая структура
  const h2Count = (input.body_html.match(/<h2\b/gi) ?? []).length
  // alt у изображений
  const imgs = input.body_html.match(/<img\b[^>]*>/gi) ?? []
  const imgsWithoutAlt = imgs.filter((tag) => !/alt\s*=\s*"[^"]+"/i.test(tag)).length
  // Ссылки
  const internalLinks = (input.body_html.match(/href="\/(?!\/)/g) ?? []).length
  const externalLinks = (input.body_html.match(/href="https?:/g) ?? []).length

  const checks: SeoCheck[] = [
    {
      id: 'title_length',
      label: `SEO-заголовок: ${effectiveTitle.length} симв.`,
      status:
        effectiveTitle.length === 0
          ? 'fail'
          : effectiveTitle.length < 30
            ? 'warn'
            : effectiveTitle.length <= 60
              ? 'pass'
              : 'warn',
      hint: 'Оптимально 30–60 символов — иначе Google обрежет.',
      weight: 12,
    },
    {
      id: 'desc_length',
      label: `SEO-описание: ${effectiveDesc.length} симв.`,
      status:
        effectiveDesc.length === 0
          ? 'fail'
          : effectiveDesc.length < 80
            ? 'warn'
            : effectiveDesc.length <= 160
              ? 'pass'
              : 'warn',
      hint: 'Оптимально 80–160 символов — это длина snippet в Google.',
      weight: 12,
    },
    {
      id: 'cover',
      label: 'Обложка / OG image',
      status: cover ? 'pass' : 'fail',
      hint: 'Без обложки share-карточки в соцсетях выглядят пусто.',
      weight: 8,
    },
    {
      id: 'word_count',
      label: `Объём: ${wordCount} слов`,
      status:
        wordCount === 0 ? 'fail' : wordCount < 300 ? 'warn' : wordCount < 600 ? 'pass' : 'pass',
      hint: 'Минимум 300 слов для индексации. Тексты 600+ ранжируются лучше.',
      weight: 10,
    },
    {
      id: 'h2_structure',
      label: h2Count === 0 ? 'Нет подзаголовков H2' : `H2-подзаголовков: ${h2Count}`,
      status: h2Count >= 2 ? 'pass' : h2Count === 1 ? 'warn' : 'fail',
      hint: 'Минимум 2 H2 — это структура читаемой статьи для скимминга.',
      weight: 8,
    },
    {
      id: 'h1_unique',
      label:
        h1Matches === 0
          ? 'H1 — берётся из заголовка (нет в теле)'
          : h1Matches === 1
            ? 'H1 в теле — задублирован'
            : `H1 в теле: ${h1Matches} (слишком много)`,
      status: h1Matches === 0 ? 'pass' : 'warn',
      hint: 'H1 должен быть один — это заголовок статьи. В теле используйте H2/H3.',
      weight: 6,
    },
    {
      id: 'img_alt',
      label:
        imgs.length === 0
          ? 'Нет изображений'
          : imgsWithoutAlt === 0
            ? `Все ${imgs.length} картинки с alt`
            : `${imgsWithoutAlt} из ${imgs.length} без alt`,
      status: imgs.length === 0 ? 'warn' : imgsWithoutAlt === 0 ? 'pass' : 'fail',
      hint: 'alt-атрибут нужен для доступности и SEO.',
      weight: 6,
    },
    {
      id: 'links',
      label: `Ссылки: ${internalLinks} внутр., ${externalLinks} внеш.`,
      status:
        internalLinks + externalLinks === 0
          ? 'warn'
          : internalLinks >= 1 && externalLinks >= 1
            ? 'pass'
            : 'warn',
      hint: 'Хотя бы 1 внутренняя ссылка (на другие статьи) и 1 внешняя авторитетная.',
      weight: 6,
    },
    {
      id: 'keywords',
      label: keywords.length > 0 ? `Keywords: ${keywords.length}` : 'Нет keywords',
      status: keywords.length === 0 ? 'warn' : keywords.length <= 8 ? 'pass' : 'warn',
      hint: 'Оптимально 3–8 ключевых слов. Больше — спам.',
      weight: 6,
    },
    {
      id: 'target_in_title',
      label: target
        ? effectiveTitle.toLowerCase().includes(target.toLowerCase())
          ? 'Целевое слово есть в title'
          : 'Целевое слово НЕ в title'
        : 'Целевое слово не задано',
      status: !target
        ? 'warn'
        : effectiveTitle.toLowerCase().includes(target.toLowerCase())
          ? 'pass'
          : 'fail',
      hint: 'Точное вхождение целевого ключа в title заметно поднимает CTR.',
      weight: 10,
    },
    {
      id: 'density',
      label: target
        ? `Плотность «${target}»: ${density.toFixed(1)}%`
        : 'Плотность ключа не считается',
      status: !target ? 'warn' : densityVerdict === 'good' ? 'pass' : 'warn',
      hint: 'Оптимально 0.5–3%. Слишком мало — поиск не поймёт тему; много — keyword stuffing.',
      weight: 8,
    },
    {
      id: 'slug',
      label: input.slug
        ? input.slug.length <= 60
          ? `URL: /${input.slug}`
          : `URL длинный: ${input.slug.length} симв.`
        : 'URL пустой',
      status: !input.slug ? 'fail' : input.slug.length > 60 ? 'warn' : 'pass',
      hint: 'Короткий URL запоминается, индексируется и шарится лучше.',
      weight: 8,
    },
  ]

  // Score = взвешенная сумма passes + 0.5 × warns
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0)
  const earned = checks.reduce(
    (s, c) => s + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0),
    0,
  )
  const score = Math.round((earned / totalWeight) * 100)

  return { score, checks, wordCount, readingMinutes, density, densityVerdict }
}
