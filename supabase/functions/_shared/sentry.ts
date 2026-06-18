/**
 * Минимальный Sentry-клиент для edge functions без зависимостей.
 *
 * SDK `@sentry/deno` тащит много кода в bundle и плохо работает в Deno
 * runtime Supabase (CompactEdge). Вместо него вызываем legacy `/store/`
 * endpoint напрямую: один fetch, безопасно если DSN не задан.
 *
 * Использование:
 *   import { captureException } from '../_shared/sentry.ts'
 *   try { ... } catch (e) { await captureException(e, { fn: 'wfirma-sync' }) }
 *
 * ENV:
 *   SENTRY_DSN_SERVER — формат `https://<publicKey>@<host>/<projectId>`
 */

const DSN = Deno.env.get('SENTRY_DSN_SERVER') ?? ''

interface ParsedDsn {
  publicKey: string
  host: string
  projectId: string
}

let cachedDsn: ParsedDsn | null = null
let dsnParsed = false

function parseDsn(): ParsedDsn | null {
  if (dsnParsed) return cachedDsn
  dsnParsed = true
  if (!DSN) return (cachedDsn = null)
  const m = DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/)
  if (!m) {
    console.warn('SENTRY_DSN_SERVER format unrecognized')
    return (cachedDsn = null)
  }
  cachedDsn = { publicKey: m[1]!, host: m[2]!, projectId: m[3]! }
  return cachedDsn
}

function uuid(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/**
 * Отправляет ошибку в Sentry. Никогда не бросает — если что-то пошло не так,
 * только console.warn. Не блокирует основной flow edge function.
 */
export async function captureException(
  err: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  // Всегда логируем в Supabase logs (видно в Dashboard 7 дней)
  console.error('captured:', err, context)

  const dsn = parseDsn()
  if (!dsn) return

  const errObj = err instanceof Error ? err : new Error(String(err))
  const event = {
    event_id: uuid(),
    timestamp: new Date().toISOString(),
    level: 'error',
    platform: 'javascript',
    sdk: { name: 'finkley.edge', version: '1.0' },
    server_name: 'supabase-edge',
    exception: {
      values: [
        {
          type: errObj.name || 'Error',
          value: errObj.message || String(err),
          stacktrace: errObj.stack ? { frames: parseStack(errObj.stack) } : undefined,
        },
      ],
    },
    extra: context,
    tags: {
      runtime: 'deno',
      ...(context.fn ? { fn: String(context.fn) } : {}),
    },
  }

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=finkley.edge/1.0`,
      },
      body: JSON.stringify(event),
    })
    clearTimeout(t)
    if (!res.ok) {
      console.warn('Sentry send failed:', res.status, await res.text().catch(() => ''))
    }
  } catch (e) {
    console.warn('Sentry exception:', e instanceof Error ? e.message : e)
  }
}

/**
 * Отправляет message-событие в Sentry (не исключение). Для аудита/алертов
 * вроде «выдана награда» или «достигнут лимит выдачи». Никогда не бросает.
 */
export async function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context: Record<string, unknown> = {},
): Promise<void> {
  console.log(`[sentry:${level}]`, message, context)

  const dsn = parseDsn()
  if (!dsn) return

  const event = {
    event_id: uuid(),
    timestamp: new Date().toISOString(),
    level,
    platform: 'javascript',
    sdk: { name: 'finkley.edge', version: '1.0' },
    server_name: 'supabase-edge',
    message: { formatted: message },
    extra: context,
    tags: {
      runtime: 'deno',
      ...(context.fn ? { fn: String(context.fn) } : {}),
    },
  }

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=finkley.edge/1.0`,
      },
      body: JSON.stringify(event),
    })
    clearTimeout(t)
    if (!res.ok) {
      console.warn('Sentry message send failed:', res.status, await res.text().catch(() => ''))
    }
  } catch (e) {
    console.warn('Sentry message exception:', e instanceof Error ? e.message : e)
  }
}

/**
 * Обёртка для Deno.serve — ловит любые unhandled exceptions из handler'а
 * и шлёт в Sentry с тегом fn=<name>. Возвращает 500 c { ok: false, error: 'internal' }
 * чтобы клиент видел стандартизованный ответ.
 *
 * Использование:
 *   Deno.serve(withSentry('booksy-proxy', async (req) => { ... }))
 */
export function withSentry(
  fn: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req)
    } catch (err) {
      await captureException(err, { fn })
      return new Response(JSON.stringify({ ok: false, error: 'internal' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
  }
}

function parseStack(
  stack: string,
): Array<{ filename?: string; function?: string; lineno?: number }> {
  return stack
    .split('\n')
    .slice(1, 30)
    .map((line) => {
      const m = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/)
      if (!m) return { filename: line.trim() }
      return {
        function: m[1] || undefined,
        filename: m[2] || undefined,
        lineno: m[3] ? parseInt(m[3], 10) : undefined,
      }
    })
}
