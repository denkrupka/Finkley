/**
 * Общие helpers для интеграционных тестов RPC.
 * Экспортируем bootstrap/teardown чтобы новые тесты не копипастили 60 строк.
 *
 * Все *_TEST env-переменные опциональны. Если их нет — тесты пропускаются
 * через describe.skipIf (см. shouldSkip).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL_TEST || 'http://127.0.0.1:54321'
export const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST || ''
export const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_TEST || ''

/** Явный opt-out для локальных запусков `pnpm test`. Когда юзер делает
 *  full-suite run после большого рефактора, эти интеграционные тесты
 *  ловят `AuthApiError: Database error creating new user` от Supabase
 *  staging (rate-limit на 30/час) и маскируют реальные регрессии в
 *  pure-unit тестах. Set SKIP_INTEGRATION_TESTS=1 (или просто не задавай
 *  *_TEST env) — тесты скипнутся через describe.skipIf(shouldSkip). */
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION_TESTS === '1'

export const shouldSkip = SKIP_INTEGRATION || !SUPABASE_ANON || !SUPABASE_SERVICE

let counter = 0
export function makeClient(key: string, prefix = 'test'): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `${prefix}-${++counter}`,
    },
  })
}

export type Ctx = {
  userId: string
  userClient: SupabaseClient
  admin: SupabaseClient
  salonId: string
}

export async function bootstrap(prefix: string): Promise<Ctx> {
  const admin = makeClient(SUPABASE_SERVICE, `${prefix}-admin`)
  const ts = Date.now()
  const email = `${prefix}-${ts}@finkley.test`
  // T78 — retry с exponential backoff + jitter для «Database error creating
  // new user» (Supabase auth rate-limit, периодически бьёт integration tests).
  let created: Awaited<ReturnType<typeof admin.auth.admin.createUser>>['data'] | null = null
  let e1: Awaited<ReturnType<typeof admin.auth.admin.createUser>>['error'] | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    created = res.data
    e1 = res.error
    if (!e1 && created?.user) break
    const msg = e1?.message ?? ''
    // Retry только на rate-limit / DB-creation; не на conflict (409 duplicate).
    if (!/database error|rate.?limit|too many/i.test(msg)) break
    // Backoff: 500, 1000, 2000, 4000ms + jitter
    const delayMs = 500 * 2 ** attempt + Math.random() * 250
    await new Promise((r) => setTimeout(r, delayMs))
  }
  if (e1 || !created?.user) throw e1 ?? new Error('user not created')

  const userClient = makeClient(SUPABASE_ANON, `${prefix}-user`)
  await userClient.auth.signInWithPassword({ email, password: 'TestPass123!' })

  const { data: salon, error: e2 } = await admin
    .from('salons')
    .insert({
      name: `${prefix} Test`,
      country_code: 'PL',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      salon_type: 'hair',
      locale: 'ru',
      created_by: created.user.id,
    })
    .select('id')
    .single()
  if (e2 || !salon) throw e2 ?? new Error('salon not created')

  const { error: e3 } = await admin
    .from('salon_members')
    .insert({ salon_id: salon.id, user_id: created.user.id, role: 'owner' })
  if (e3) throw e3

  return { userId: created.user.id, userClient, admin, salonId: salon.id }
}

export async function teardown(ctx: Ctx | null): Promise<void> {
  if (!ctx) return
  const admin = makeClient(SUPABASE_SERVICE, 'teardown')
  await admin.from('salons').delete().eq('id', ctx.salonId)
  await admin.auth.admin.deleteUser(ctx.userId)
}
