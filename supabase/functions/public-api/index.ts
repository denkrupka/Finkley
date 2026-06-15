/**
 * public-api — публичный REST API FinSalon для собственных интеграций салона
 * (Zapier, n8n, Make, скрипты). Аутентификация — по ключу `fnk_live_…`,
 * созданному в Настройки → API (Edge Function api-keys-create).
 *
 * Базовый URL:  <SUPABASE_URL>/functions/v1/public-api
 * Версия путей: /v1/<resource>[/<id>]
 *
 * Аутентификация:
 *   Authorization: Bearer fnk_live_…      (или заголовок x-api-key: fnk_live_…)
 *
 * Scopes:
 *   read  → GET           write → POST/PATCH/DELETE
 *
 * Безопасность (см. decisions/032-public-api.md):
 *   - verify_jwt = false в config.toml: Supabase-gateway НЕ требует JWT,
 *     потому что аутентификация делается нашим ключом внутри функции.
 *   - service-role используется ТОЛЬКО здесь (в Edge), каждый запрос жёстко
 *     ограничен салоном ключа. Клиент не может задать salon_id.
 *   - Декларативный реестр (registry.ts) — единственный whitelist таблиц,
 *     колонок и методов. Ничего вне реестра наружу не попадает.
 *
 * Эндпоинты без ключа (публичные):
 *   GET /v1            — каталог API (для документации/discovery)
 *   GET /v1/_catalog   — то же
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { withSentry } from '../_shared/sentry.ts'
import { buildCatalog, findResource, type ResourceDef } from './registry.ts'
import {
  clampLimit,
  extractApiKey,
  hasScope,
  invalidMoneyField,
  isDateLike,
  isUuid,
  missingRequired,
  parseApiPath,
  parseOffset,
  parseSort,
  pickAllowed,
  scopeForMethod,
  sha256Hex,
} from './lib.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type, accept',
  'Access-Control-Max-Age': '86400',
}

type ErrCode =
  | 'unauthorized'
  | 'invalid_key'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'internal'

/** Типизированная ошибка API — несёт http-статус и машинный код. */
class ApiError extends Error {
  status: number
  code: ErrCode
  constructor(status: number, code: ErrCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function ok(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

function fail(err: ApiError): Response {
  return ok({ error: { code: err.code, message: err.message } }, err.status)
}

type KeyContext = { keyId: string; salonId: string; scopes: string[] }

/** Аутентификация по ключу. Бросает ApiError при проблеме. */
async function authenticate(admin: SupabaseClient, req: Request): Promise<KeyContext> {
  const key = extractApiKey(req.headers)
  if (!key) {
    throw new ApiError(
      401,
      'unauthorized',
      'Missing API key. Use Authorization: Bearer fnk_live_… or x-api-key.',
    )
  }
  const keyHash = await sha256Hex(key)
  const { data, error } = await admin
    .from('api_keys')
    .select('id, salon_id, scopes, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (error) throw new ApiError(500, 'internal', 'Auth lookup failed.')
  if (!data || data.revoked_at) {
    throw new ApiError(401, 'invalid_key', 'API key is invalid or revoked.')
  }
  // last_used_at — ленивое обновление, не блокируем ответ.
  admin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(
      () => {},
      () => {}, // fire-and-forget: ошибка обновления last_used_at не должна ронять запрос
    )
  return {
    keyId: data.id,
    salonId: data.salon_id as string,
    scopes: (data.scopes as string[]) ?? [],
  }
}

/** Резолвит id банковских счетов салона (для bankScope). */
async function salonAccountIds(admin: SupabaseClient, salonId: string): Promise<string[]> {
  const { data: conns } = await admin.from('bank_connections').select('id').eq('salon_id', salonId)
  const connIds = (conns ?? []).map((c) => c.id as string)
  if (!connIds.length) return []
  const { data: accs } = await admin.from('bank_accounts').select('id').in('connection_id', connIds)
  return (accs ?? []).map((a) => a.id as string)
}

async function salonConnectionIds(admin: SupabaseClient, salonId: string): Promise<string[]> {
  const { data: conns } = await admin.from('bank_connections').select('id').eq('salon_id', salonId)
  return (conns ?? []).map((c) => c.id as string)
}

/**
 * Применяет salon-scope к read-запросу. Возвращает either:
 *  - { query } — модифицированный запрос
 *  - { empty: true } — салону нечего показывать (нет банк-связей) → пустой ответ
 * Бросает ApiError для parent-scope без валидного параметра.
 */
async function applyReadScope(
  admin: SupabaseClient,
  // deno-lint-ignore no-explicit-any
  query: any,
  resource: ResourceDef,
  salonId: string,
  url: URL,
  // deno-lint-ignore no-explicit-any
): Promise<{ query?: any; empty?: boolean }> {
  if (resource.salonColumn) {
    return { query: query.eq(resource.salonColumn, salonId) }
  }
  if (resource.parentScope) {
    const ps = resource.parentScope
    const pid = url.searchParams.get(ps.param)
    if (!isUuid(pid)) {
      throw new ApiError(
        400,
        'invalid_request',
        `Query param ${ps.param} (uuid) is required for ${resource.resource}.`,
      )
    }
    const { data: parent } = await admin
      .from(ps.parentTable)
      .select('id')
      .eq('id', pid)
      .eq(ps.parentSalonColumn, salonId)
      .maybeSingle()
    if (!parent) {
      throw new ApiError(404, 'not_found', `Parent ${ps.param} not found in your salon.`)
    }
    return { query: query.eq(ps.column, pid) }
  }
  if (resource.bankScope === 'accounts') {
    const ids = await salonConnectionIds(admin, salonId)
    if (!ids.length) return { empty: true }
    return { query: query.in('connection_id', ids) }
  }
  if (resource.bankScope === 'transactions') {
    const ids = await salonAccountIds(admin, salonId)
    if (!ids.length) return { empty: true }
    return { query: query.in('account_id', ids) }
  }
  // Не должно случаться: ресурс без способа скоупинга.
  throw new ApiError(500, 'internal', 'Resource has no scoping rule.')
}

/** GET список. */
async function handleList(
  admin: SupabaseClient,
  resource: ResourceDef,
  salonId: string,
  url: URL,
): Promise<Response> {
  const limit = clampLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))

  let query = admin.from(resource.table).select(resource.read.join(','), { count: 'exact' })
  const scoped = await applyReadScope(admin, query, resource, salonId, url)
  if (scoped.empty) {
    return ok({ data: [], pagination: { limit, offset, count: 0, has_more: false } })
  }
  query = scoped.query

  if (resource.softDeleteColumn) query = query.is(resource.softDeleteColumn, null)

  for (const col of resource.filters) {
    const v = url.searchParams.get(col)
    if (v !== null) query = query.eq(col, v)
  }

  if (resource.dateColumn) {
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from) {
      if (!isDateLike(from))
        throw new ApiError(
          400,
          'invalid_request',
          'Param "from" must be a date (YYYY-MM-DD or ISO).',
        )
      query = query.gte(resource.dateColumn, from)
    }
    if (to) {
      if (!isDateLike(to))
        throw new ApiError(400, 'invalid_request', 'Param "to" must be a date (YYYY-MM-DD or ISO).')
      query = query.lte(resource.dateColumn, to)
    }
  }

  const sort = parseSort(
    url.searchParams.get('order'),
    url.searchParams.get('dir'),
    resource.read,
    resource.defaultOrder,
  )
  if (sort) query = query.order(sort.column, { ascending: sort.ascending })

  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) throw new ApiError(400, 'invalid_request', error.message)
  const total = count ?? 0
  return ok({
    data: data ?? [],
    pagination: { limit, offset, count: total, has_more: offset + (data?.length ?? 0) < total },
  })
}

/** GET один по id. */
async function handleGetOne(
  admin: SupabaseClient,
  resource: ResourceDef,
  salonId: string,
  id: string,
  url: URL,
): Promise<Response> {
  if (!isUuid(id)) throw new ApiError(400, 'invalid_request', 'Invalid id (uuid expected).')
  let query = admin.from(resource.table).select(resource.read.join(','))
  const scoped = await applyReadScope(admin, query, resource, salonId, url)
  if (scoped.empty) throw new ApiError(404, 'not_found', 'Resource not found.')
  query = scoped.query
  if (resource.softDeleteColumn) query = query.is(resource.softDeleteColumn, null)
  const { data, error } = await query.eq(resource.pk, id).maybeSingle()
  if (error) throw new ApiError(400, 'invalid_request', error.message)
  if (!data) throw new ApiError(404, 'not_found', 'Resource not found.')
  return ok({ data })
}

/** Парсит JSON-тело. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ApiError(400, 'invalid_request', 'Body must be valid JSON.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'invalid_request', 'Body must be a JSON object.')
  }
  return body as Record<string, unknown>
}

/** POST создать. */
async function handleCreate(
  admin: SupabaseClient,
  resource: ResourceDef,
  salonId: string,
  req: Request,
): Promise<Response> {
  if (resource.kind !== 'table' || !resource.create.length || !resource.salonColumn) {
    throw new ApiError(405, 'method_not_allowed', `${resource.resource} is read-only.`)
  }
  const body = await readBody(req)
  const payload = pickAllowed(body, resource.create)

  const missing = missingRequired(payload, resource.required)
  if (missing.length) {
    throw new ApiError(400, 'invalid_request', `Missing required fields: ${missing.join(', ')}.`)
  }
  const badMoney = invalidMoneyField(payload, resource.money)
  if (badMoney) {
    throw new ApiError(
      400,
      'invalid_request',
      `Field ${badMoney} must be an integer amount in minor units (cents).`,
    )
  }

  // salon_id всегда проставляется сервером — клиент его задать не может.
  payload[resource.salonColumn] = salonId

  const { data, error } = await admin
    .from(resource.table)
    .insert(payload)
    .select(resource.read.join(','))
    .maybeSingle()
  if (error) throw new ApiError(400, 'invalid_request', error.message)
  return ok({ data }, 201)
}

/** PATCH обновить по id. */
async function handleUpdate(
  admin: SupabaseClient,
  resource: ResourceDef,
  salonId: string,
  id: string,
  req: Request,
): Promise<Response> {
  if (resource.kind !== 'table' || !resource.update.length || !resource.salonColumn) {
    throw new ApiError(405, 'method_not_allowed', `${resource.resource} is not updatable.`)
  }
  if (!isUuid(id)) throw new ApiError(400, 'invalid_request', 'Invalid id (uuid expected).')
  const body = await readBody(req)
  const payload = pickAllowed(body, resource.update)
  if (Object.keys(payload).length === 0) {
    throw new ApiError(400, 'invalid_request', 'No updatable fields in body.')
  }
  const badMoney = invalidMoneyField(payload, resource.money)
  if (badMoney) {
    throw new ApiError(
      400,
      'invalid_request',
      `Field ${badMoney} must be an integer amount in minor units (cents).`,
    )
  }

  const { data, error } = await admin
    .from(resource.table)
    .update(payload)
    .eq(resource.salonColumn, salonId)
    .eq(resource.pk, id)
    .select(resource.read.join(','))
    .maybeSingle()
  if (error) throw new ApiError(400, 'invalid_request', error.message)
  if (!data) throw new ApiError(404, 'not_found', 'Resource not found.')
  return ok({ data })
}

/** DELETE по id (soft, если есть soft-delete колонка). */
async function handleDelete(
  admin: SupabaseClient,
  resource: ResourceDef,
  salonId: string,
  id: string,
): Promise<Response> {
  if (resource.kind !== 'table' || !resource.allowDelete || !resource.salonColumn) {
    throw new ApiError(405, 'method_not_allowed', `${resource.resource} cannot be deleted.`)
  }
  if (!isUuid(id)) throw new ApiError(400, 'invalid_request', 'Invalid id (uuid expected).')

  let result
  if (resource.softDeleteColumn) {
    result = await admin
      .from(resource.table)
      .update({ [resource.softDeleteColumn]: new Date().toISOString() })
      .eq(resource.salonColumn, salonId)
      .eq(resource.pk, id)
      .select('id')
      .maybeSingle()
  } else {
    result = await admin
      .from(resource.table)
      .delete()
      .eq(resource.salonColumn, salonId)
      .eq(resource.pk, id)
      .select('id')
      .maybeSingle()
  }
  if (result.error) throw new ApiError(400, 'invalid_request', result.error.message)
  if (!result.data) throw new ApiError(404, 'not_found', 'Resource not found.')
  return ok({ deleted: true, id })
}

/** GET RPC (аналитика). */
async function handleRpc(
  admin: SupabaseClient,
  resource: ResourceDef,
  salonId: string,
  url: URL,
): Promise<Response> {
  const rpc = resource.rpc!
  const args: Record<string, unknown> = { [rpc.salonArg]: salonId }
  const missing: string[] = []
  for (const a of rpc.args) {
    const raw = url.searchParams.get(a.query)
    if (raw === null || raw === '') {
      if (a.required) missing.push(a.query)
      continue
    }
    if (a.numeric) {
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        throw new ApiError(400, 'invalid_request', `Query param ${a.query} must be a number.`)
      }
      args[a.rpcParam] = Math.trunc(n)
    } else {
      args[a.rpcParam] = raw
    }
  }
  if (missing.length) {
    throw new ApiError(
      400,
      'invalid_request',
      `Missing required query params: ${missing.join(', ')}.`,
    )
  }
  const { data, error } = await admin.rpc(rpc.fn, args)
  if (error) throw new ApiError(400, 'invalid_request', error.message)
  return ok({ data: data ?? null })
}

async function route(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return fail(new ApiError(503, 'internal', 'Service is not configured.'))
  }

  const url = new URL(req.url)
  const parsed = parseApiPath(url.pathname)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // Публичный каталог — без ключа (для документации/discovery).
    if (parsed.isCatalog) {
      if (req.method !== 'GET')
        throw new ApiError(405, 'method_not_allowed', 'Catalog is GET-only.')
      return ok(buildCatalog())
    }

    // Всё остальное требует ключ.
    const ctx = await authenticate(admin, req)

    // Интроспекция ключа.
    if (parsed.isMe) {
      if (req.method !== 'GET') throw new ApiError(405, 'method_not_allowed', '/me is GET-only.')
      const { data: salon } = await admin
        .from('salons')
        .select('id, name, currency, timezone, country_code, locale')
        .eq('id', ctx.salonId)
        .maybeSingle()
      return ok({ data: { salon: salon ?? { id: ctx.salonId }, scopes: ctx.scopes } })
    }

    const resource = parsed.resource ? findResource(parsed.resource) : undefined
    if (!resource) {
      throw new ApiError(404, 'not_found', `Unknown resource. See GET /v1 for the catalog.`)
    }

    // Проверка прав по методу.
    const needed = scopeForMethod(req.method)
    if (!hasScope(ctx.scopes, needed)) {
      throw new ApiError(
        403,
        'forbidden',
        `This action requires '${needed}' scope. Create a key with it in Settings → API.`,
      )
    }

    if (resource.kind === 'rpc') {
      if (req.method !== 'GET')
        throw new ApiError(405, 'method_not_allowed', 'Analytics endpoints are GET-only.')
      return await handleRpc(admin, resource, ctx.salonId, url)
    }

    switch (req.method) {
      case 'GET':
        return parsed.id
          ? await handleGetOne(admin, resource, ctx.salonId, parsed.id, url)
          : await handleList(admin, resource, ctx.salonId, url)
      case 'POST':
        if (parsed.id)
          throw new ApiError(405, 'method_not_allowed', 'POST is for the collection, not an id.')
        return await handleCreate(admin, resource, ctx.salonId, req)
      case 'PATCH':
        if (!parsed.id) throw new ApiError(400, 'invalid_request', 'PATCH requires /<id>.')
        return await handleUpdate(admin, resource, ctx.salonId, parsed.id, req)
      case 'DELETE':
        if (!parsed.id) throw new ApiError(400, 'invalid_request', 'DELETE requires /<id>.')
        return await handleDelete(admin, resource, ctx.salonId, parsed.id)
      default:
        throw new ApiError(405, 'method_not_allowed', `Method ${req.method} not allowed.`)
    }
  } catch (err) {
    if (err instanceof ApiError) return fail(err)
    // Непредвиденное — логируем (Sentry) и отдаём cors'd 500.
    console.error('public-api unexpected:', err)
    return fail(new ApiError(500, 'internal', 'Internal error.'))
  }
}

// Экспортируем route для smoke-тестов (см. smoke.test.ts). Сервер поднимаем
// только когда модуль — точка входа (в Supabase runtime), не при импорте в тест.
export { route }

if (import.meta.main) {
  Deno.serve(withSentry('public-api', route))
}
