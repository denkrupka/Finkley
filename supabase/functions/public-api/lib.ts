/**
 * public-api/lib.ts — чистые (без Deno-зависимостей) хелперы публичного API.
 *
 * Вынесены отдельно от index.ts чтобы покрыть unit-тестами (`deno test`)
 * без сети и без поднятого Supabase. Здесь НЕТ обращений к БД и к Deno.env —
 * только разбор запроса, валидация и санитизация. Вся логика безопасности,
 * которую можно проверить детерминированно, живёт тут.
 */

/** Разобранный путь запроса к public-api. */
export type ParsedPath = {
  /** Версия API из пути (`v1`) или null если не указана. */
  version: string | null
  /** Слаг ресурса (`visits`) или null. */
  resource: string | null
  /** id записи (для /resource/:id) или null. */
  id: string | null
  /** GET /v1 или /v1/_catalog — публичный каталог (без ключа). */
  isCatalog: boolean
  /** GET /v1/me — интроспекция ключа. */
  isMe: boolean
}

/**
 * Достаёт значимую часть пути после имени функции `public-api` и парсит её.
 *
 * Supabase отдаёт pathname вида `/public-api/v1/visits/<id>` (имя функции —
 * первый сегмент). На всякий случай срезаем и возможный префикс
 * `/functions/v1`. Версия (`v1`) опциональна, но рекомендуется.
 */
export function parseApiPath(pathname: string): ParsedPath {
  const marker = '/public-api'
  const idx = pathname.indexOf(marker)
  let rest = idx >= 0 ? pathname.slice(idx + marker.length) : pathname
  const parts = rest.split('/').filter(Boolean)

  let i = 0
  let version: string | null = null
  if (parts[i] && /^v\d+$/.test(parts[i]!)) {
    version = parts[i]!
    i++
  }
  const resource = parts[i] ?? null
  const id = parts[i + 1] ?? null

  const isCatalog = resource === null || resource === '_catalog'
  const isMe = resource === 'me'

  return {
    version,
    resource: isCatalog || isMe ? (isMe ? 'me' : null) : resource,
    id,
    isCatalog,
    isMe,
  }
}

/** Формат публичного ключа: fnk_live_<base32-ish>. */
const KEY_RE = /^fnk_live_[A-Za-z0-9]{8,64}$/

/**
 * Извлекает API-ключ из заголовков. Поддерживает `Authorization: Bearer <key>`
 * и `x-api-key: <key>`. Возвращает null если ключа нет или формат не наш
 * (чтобы не хешировать мусор).
 */
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) {
    const k = auth.slice('Bearer '.length).trim()
    if (KEY_RE.test(k)) return k
  }
  const x = headers.get('x-api-key')?.trim()
  if (x && KEY_RE.test(x)) return x
  return null
}

/** SHA-256 hex от строки. Web Crypto есть и в Deno, и в Node 18+. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Проверка наличия нужного scope (read/write). */
export function hasScope(scopes: string[] | null | undefined, needed: 'read' | 'write'): boolean {
  if (!scopes) return false
  return scopes.includes(needed)
}

/** Какой scope требует HTTP-метод. */
export function scopeForMethod(method: string): 'read' | 'write' {
  return method === 'GET' ? 'read' : 'write'
}

/**
 * Оставляет в объекте только разрешённые ключи (whitelist). Server-managed
 * поля (id, salon_id, created_at, …) физически не попадут в insert/update,
 * даже если клиент их прислал.
 */
export function pickAllowed(
  body: Record<string, unknown>,
  allowed: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key]
  }
  return out
}

/** limit: дефолт 50, минимум 1, максимум 200 (защита от тяжёлых выборок). */
export function clampLimit(raw: string | null, def = 50, max = 200): number {
  const n = raw == null ? def : Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(Math.trunc(n), 1), max)
}

/** offset: дефолт 0, не отрицательный. */
export function parseOffset(raw: string | null): number {
  const n = raw == null ? 0 : Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(s: string | null | undefined): boolean {
  return !!s && UUID_RE.test(s)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/

/**
 * Дата/таймстамп выглядит валидно (YYYY-MM-DD или ISO). Нужно, чтобы не
 * прокидывать произвольную строку в PostgREST .gte/.lte (иначе PG вернёт
 * детальную ошибку, раскрывающую тип/имя колонки).
 */
export function isDateLike(s: string): boolean {
  return DATE_RE.test(s)
}

/**
 * Деньги в API — всегда целые минорные единицы (копейки/центы). Проверяем,
 * что присланные money-поля — целые числа (не float, не строка), иначе 400.
 * Возвращает имя первого невалидного поля или null если всё ок.
 */
export function invalidMoneyField(
  body: Record<string, unknown>,
  moneyCols: string[],
): string | null {
  for (const col of moneyCols) {
    if (!Object.prototype.hasOwnProperty.call(body, col)) continue
    const v = body[col]
    if (v === null) continue
    if (typeof v !== 'number' || !Number.isInteger(v)) return col
  }
  return null
}

/**
 * Проверяет, что в теле присутствуют все обязательные на создание поля.
 * Возвращает массив отсутствующих (пустой = ок).
 */
export function missingRequired(body: Record<string, unknown>, required: string[]): string[] {
  return required.filter(
    (k) =>
      !Object.prototype.hasOwnProperty.call(body, k) ||
      body[k] === null ||
      body[k] === undefined ||
      body[k] === '',
  )
}

export type SortSpec = { column: string; ascending: boolean }

/**
 * Разбирает order/dir из query. Колонка должна быть в whitelist (readable),
 * иначе возвращаем дефолт. dir: asc|desc.
 */
export function parseSort(
  orderRaw: string | null,
  dirRaw: string | null,
  readable: string[],
  fallback: SortSpec | null,
): SortSpec | null {
  if (orderRaw && readable.includes(orderRaw)) {
    return { column: orderRaw, ascending: (dirRaw ?? 'desc').toLowerCase() !== 'desc' }
  }
  return fallback
}
