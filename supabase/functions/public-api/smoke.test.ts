/**
 * Smoke-тест роутинга public-api без БД (`deno test --allow-env --allow-net`).
 *
 * Проверяем пути, которые НЕ обращаются к базе: discovery-каталог, CORS,
 * ранний возврат 401 без ключа, 405 на неверный метод. Полный e2e (CRUD)
 * требует поднятого Supabase-стека и проверяется на staging при деплое.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

// Dummy env ДО динамического импорта модуля (консты читаются при загрузке).
Deno.env.set('SUPABASE_URL', 'http://localhost:9')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'dummy-service-key')

const { route } = await import('./index.ts')

const req = (method: string, path: string, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${path}`, { method, headers })

Deno.test('OPTIONS → 204 + CORS', async () => {
  const res = await route(req('OPTIONS', '/public-api/v1/visits'))
  assertEquals(res.status, 204)
  assertEquals(res.headers.get('access-control-allow-origin'), '*')
})

Deno.test('GET /v1 → каталог 200, без ключа', async () => {
  const res = await route(req('GET', '/public-api/v1'))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.version, 'v1')
  assertEquals(Array.isArray(body.resources), true)
  // ключевые ресурсы на месте
  const slugs = body.resources.map((r: { resource: string }) => r.resource)
  assertEquals(slugs.includes('visits'), true)
  assertEquals(slugs.includes('expenses'), true)
  assertEquals(slugs.includes('dashboard-kpis'), true)
  // секреты/глобальное наружу не попали
  assertEquals(slugs.includes('media-posts'), false)
  assertEquals(slugs.includes('api-keys'), false)
})

Deno.test('POST /v1 (каталог) → 405', async () => {
  const res = await route(req('POST', '/public-api/v1'))
  assertEquals(res.status, 405)
})

Deno.test('GET /v1/visits без ключа → 401', async () => {
  const res = await route(req('GET', '/public-api/v1/visits'))
  assertEquals(res.status, 401)
  const body = await res.json()
  assertEquals(body.error.code, 'unauthorized')
})

Deno.test('GET /v1/me без ключа → 401', async () => {
  const res = await route(req('GET', '/public-api/v1/me'))
  assertEquals(res.status, 401)
})

Deno.test('мусорный ключ распознаётся как отсутствующий → 401', async () => {
  const res = await route(req('GET', '/public-api/v1/visits', { authorization: 'Bearer garbage' }))
  assertEquals(res.status, 401)
})
