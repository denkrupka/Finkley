/**
 * Unit-тесты чистой логики public-api (`deno test`).
 * Запуск: deno test supabase/functions/public-api/lib.test.ts
 *
 * Покрываем security-критичные хелперы: разбор пути, извлечение ключа,
 * whitelist полей (нельзя протащить salon_id), валидацию денег, scope.
 */

import { assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

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

Deno.test('parseApiPath: каталог', () => {
  for (const p of [
    '/public-api',
    '/public-api/',
    '/public-api/v1',
    '/functions/v1/public-api/v1/_catalog',
  ]) {
    const r = parseApiPath(p)
    assertEquals(r.isCatalog, true, p)
  }
})

Deno.test('parseApiPath: ресурс и id', () => {
  const r = parseApiPath('/public-api/v1/visits')
  assertEquals(r.version, 'v1')
  assertEquals(r.resource, 'visits')
  assertEquals(r.id, null)
  assertEquals(r.isCatalog, false)

  const one = parseApiPath('/public-api/v1/visits/123e4567-e89b-12d3-a456-426614174000')
  assertEquals(one.resource, 'visits')
  assertEquals(one.id, '123e4567-e89b-12d3-a456-426614174000')
})

Deno.test('parseApiPath: /me', () => {
  const r = parseApiPath('/public-api/v1/me')
  assertEquals(r.isMe, true)
  assertEquals(r.resource, 'me')
})

Deno.test('parseApiPath: работает и без префикса /functions/v1', () => {
  const r = parseApiPath('/functions/v1/public-api/v1/clients/abc')
  assertEquals(r.resource, 'clients')
  assertEquals(r.id, 'abc')
})

Deno.test('extractApiKey: Bearer и x-api-key', () => {
  const key = 'fnk_live_ABCDEFGHIJKLMNOP1234567890abcdef'
  assertEquals(extractApiKey(new Headers({ authorization: `Bearer ${key}` })), key)
  assertEquals(extractApiKey(new Headers({ 'x-api-key': key })), key)
})

Deno.test('extractApiKey: мусор и чужой формат → null', () => {
  assertEquals(extractApiKey(new Headers({ authorization: 'Bearer not-a-key' })), null)
  assertEquals(extractApiKey(new Headers({ authorization: 'Bearer sk-secret' })), null)
  assertEquals(extractApiKey(new Headers({})), null)
  // JWT не должен распознаваться как наш ключ
  assertEquals(extractApiKey(new Headers({ authorization: 'Bearer eyJhbGciOi.JIUzI1.NiJ9' })), null)
})

Deno.test('sha256Hex: известный вектор', async () => {
  // sha256("abc")
  assertEquals(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

Deno.test('hasScope / scopeForMethod', () => {
  assertEquals(hasScope(['read'], 'read'), true)
  assertEquals(hasScope(['read'], 'write'), false)
  assertEquals(hasScope(['read', 'write'], 'write'), true)
  assertEquals(hasScope(null, 'read'), false)
  assertEquals(scopeForMethod('GET'), 'read')
  assertEquals(scopeForMethod('POST'), 'write')
  assertEquals(scopeForMethod('PATCH'), 'write')
  assertEquals(scopeForMethod('DELETE'), 'write')
})

Deno.test('pickAllowed: только whitelist (нельзя протащить salon_id/id)', () => {
  const body = { amount_cents: 5000, salon_id: 'EVIL', id: 'EVIL', created_at: 'x', comment: 'ok' }
  const out = pickAllowed(body, ['amount_cents', 'comment'])
  assertEquals(out, { amount_cents: 5000, comment: 'ok' })
  assertStrictEquals('salon_id' in out, false)
  assertStrictEquals('id' in out, false)
})

Deno.test('clampLimit: дефолт/мин/макс', () => {
  assertEquals(clampLimit(null), 50)
  assertEquals(clampLimit('10'), 10)
  assertEquals(clampLimit('0'), 1)
  assertEquals(clampLimit('99999'), 200)
  assertEquals(clampLimit('abc'), 50)
})

Deno.test('parseOffset', () => {
  assertEquals(parseOffset(null), 0)
  assertEquals(parseOffset('-5'), 0)
  assertEquals(parseOffset('20'), 20)
})

Deno.test('isUuid', () => {
  assertEquals(isUuid('123e4567-e89b-12d3-a456-426614174000'), true)
  assertEquals(isUuid('not-a-uuid'), false)
  assertEquals(isUuid(null), false)
  assertEquals(isUuid(''), false)
})

Deno.test('isDateLike: дата/ISO ок, мусор нет', () => {
  assertEquals(isDateLike('2026-06-15'), true)
  assertEquals(isDateLike('2026-06-15T10:30:00Z'), true)
  assertEquals(isDateLike('2026-06-15 10:30'), true)
  assertEquals(isDateLike('invalid_date'), false)
  assertEquals(isDateLike("2026'; drop table"), false)
  assertEquals(isDateLike('06/15/2026'), false)
})

Deno.test('invalidMoneyField: только целые', () => {
  assertEquals(invalidMoneyField({ amount_cents: 100 }, ['amount_cents']), null)
  assertEquals(invalidMoneyField({ amount_cents: null }, ['amount_cents']), null)
  assertEquals(invalidMoneyField({ amount_cents: 10.5 }, ['amount_cents']), 'amount_cents')
  assertEquals(invalidMoneyField({ amount_cents: '100' }, ['amount_cents']), 'amount_cents')
  assertEquals(invalidMoneyField({}, ['amount_cents']), null)
})

Deno.test('missingRequired', () => {
  assertEquals(missingRequired({ a: 1 }, ['a']), [])
  assertEquals(missingRequired({}, ['a', 'b']), ['a', 'b'])
  assertEquals(missingRequired({ a: '', b: null }, ['a', 'b']), ['a', 'b'])
})

Deno.test('parseSort: только whitelisted колонки', () => {
  const fallback = { column: 'created_at', ascending: false }
  assertEquals(parseSort('visit_at', 'asc', ['visit_at'], fallback), {
    column: 'visit_at',
    ascending: true,
  })
  assertEquals(parseSort('visit_at', 'desc', ['visit_at'], fallback), {
    column: 'visit_at',
    ascending: false,
  })
  // несуществующая/непубличная колонка → fallback (нельзя сортировать по произвольному)
  assertEquals(parseSort('key_hash', 'asc', ['visit_at'], fallback), fallback)
  assertEquals(parseSort(null, null, ['visit_at'], fallback), fallback)
})
