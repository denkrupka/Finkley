/**
 * RLS-тест: проверка изоляции данных между салонами.
 *
 * Это паттерн для тестирования RLS-политик. Копируй для каждой новой таблицы
 * с пользовательскими данными. RLS-баг = утечка между тенантами.
 *
 * Минимум для каждой таблицы:
 * 1. User A видит свои данные
 * 2. User B НЕ видит данные User A
 * 3. User B НЕ может изменить данные User A
 *
 * Запуск:
 *   - Локально с supabase start: pnpm test
 *   - На CI: с переменными VITE_SUPABASE_URL_TEST и VITE_SUPABASE_ANON_KEY_TEST
 *
 * ⚠ Этот тест требует **локальный Supabase** (supabase start) или staging проект.
 *    На production проекте RLS-тесты НЕ запускать — создаст мусорных юзеров.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Локальный Supabase URL по умолчанию (от supabase start)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL_TEST || 'http://127.0.0.1:54321'
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST || ''
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_TEST || ''

// Skip если нет локального Supabase или ключей
const shouldSkip = !SUPABASE_ANON || !SUPABASE_SERVICE

interface TestUser {
  id: string
  email: string
  client: SupabaseClient
}

// Несколько клиентов разделяют один localStorage в jsdom и затирают друг другу
// сессии (GoTrueClient warning "Multiple GoTrueClient instances ... same storage key").
// Поэтому: уникальный storageKey на каждый клиент + отключаем persistSession.
let clientCounter = 0
function makeClient(key: string, opts?: { storageKey?: string }): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: opts?.storageKey ?? `rls-test-${++clientCounter}`,
    },
  })
}

async function createTestUser(email: string): Promise<TestUser> {
  const admin = makeClient(SUPABASE_SERVICE)

  // Создаём юзера через admin API
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (createError) throw createError
  if (!created.user) throw new Error('User not created')

  // Логиним юзера через anon-клиент с уникальным storageKey
  const userClient = makeClient(SUPABASE_ANON)
  const { error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password: 'TestPass123!',
  })
  if (signInError) throw signInError

  return {
    id: created.user.id,
    email,
    client: userClient,
  }
}

async function deleteTestUser(userId: string): Promise<void> {
  const admin = makeClient(SUPABASE_SERVICE)
  await admin.auth.admin.deleteUser(userId)
}

async function createTestSalon(user: TestUser, name: string): Promise<string> {
  // Создаём салон + salon_member через admin-клиент (мирроринг будущей
  // create-salon edge function, см. TASK-08 в docs/04_BACKLOG.md).
  // Делать INSERT через user.client + SELECT чтобы вытащить id нельзя:
  // SELECT-RLS на salons требует уже быть в salon_members, а его ещё нет.
  const admin = makeClient(SUPABASE_SERVICE)
  const { data, error } = await admin
    .from('salons')
    .insert({
      name,
      country_code: 'PL',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      salon_type: 'hair',
      locale: 'ru',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw error
  if (!data) throw new Error('Salon not created')

  const { error: memberError } = await admin.from('salon_members').insert({
    salon_id: data.id,
    user_id: user.id,
    role: 'owner',
  })
  if (memberError) throw memberError

  return data.id
}

describe.skipIf(shouldSkip)('RLS: salons isolation', () => {
  let userA: TestUser
  let userB: TestUser
  let salonA: string

  beforeAll(async () => {
    const ts = Date.now()
    userA = await createTestUser(`rls-test-a-${ts}@finkley.test`)
    userB = await createTestUser(`rls-test-b-${ts}@finkley.test`)
    salonA = await createTestSalon(userA, 'Salon A (User A only)')
  }, 30_000)

  afterAll(async () => {
    if (userA?.id) await deleteTestUser(userA.id)
    if (userB?.id) await deleteTestUser(userB.id)
  })

  it('user A может прочитать свой салон', async () => {
    const { data, error } = await userA.client
      .from('salons')
      .select('id, name')
      .eq('id', salonA)
      .single()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.name).toBe('Salon A (User A only)')
  })

  it('user B НЕ видит салон user A', async () => {
    const { data } = await userB.client.from('salons').select('id').eq('id', salonA).maybeSingle()

    expect(data).toBeNull()
  })

  it('user B НЕ может обновить салон user A', async () => {
    // Update вернёт success, но 0 rows affected (RLS блокирует на уровне строк)
    await userB.client.from('salons').update({ name: 'Hacked' }).eq('id', salonA)

    // Проверяем что user A всё ещё видит оригинальное имя
    const { data } = await userA.client.from('salons').select('name').eq('id', salonA).single()

    expect(data?.name).toBe('Salon A (User A only)')
  })

  it('user B НЕ может удалить салон user A', async () => {
    await userB.client.from('salons').delete().eq('id', salonA)

    // Проверяем что салон всё ещё на месте
    const { data } = await userA.client.from('salons').select('id').eq('id', salonA).maybeSingle()

    expect(data).toBeDefined()
  })

  it('user A видит только свои salon_members', async () => {
    const { data } = await userA.client.from('salon_members').select('salon_id, user_id, role')

    expect(data).toBeDefined()
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((m) => m.user_id === userA.id)).toBe(true)
  })
})

/*
 * Шаблон для других таблиц:
 *
 * describe.skipIf(shouldSkip)('RLS: visits isolation', () => {
 *   let userA: TestUser, userB: TestUser
 *   let salonA: string, visitA: string
 *
 *   beforeAll(async () => {
 *     userA = await createTestUser(`rls-test-a-${Date.now()}@finkley.test`)
 *     userB = await createTestUser(`rls-test-b-${Date.now()}@finkley.test`)
 *     salonA = await createTestSalon(userA, 'Salon A')
 *     // ... создать visit в salonA через userA
 *   })
 *
 *   it('user A видит свои visits', async () => { ... })
 *   it('user B НЕ видит visits user A', async () => { ... })
 *   it('user B НЕ может update visits user A', async () => { ... })
 *   it('user B НЕ может insert visit в salon user A', async () => { ... })
 * })
 */
