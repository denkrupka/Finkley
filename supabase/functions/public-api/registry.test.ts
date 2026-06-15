/**
 * Инварианты реестра public-api (`deno test`). Это «страховка безопасности»:
 * гарантирует, что ни один ресурс не отдаёт секреты и не позволяет записать
 * server-managed поля, и что у каждого ресурса есть правило скоупинга по салону.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { RESOURCES, buildCatalog } from './registry.ts'

const FORBIDDEN_IN_WRITE = [
  'id',
  'salon_id',
  'created_at',
  'updated_at',
  'created_by',
  'deleted_at',
  'is_system',
  'key_hash',
  'token',
]

const SECRET_SUBSTRINGS = [
  'hash',
  'secret',
  'password',
  'credential',
  'access_token',
  'refresh_token',
  'private_key',
]

Deno.test('слаги уникальны', () => {
  const seen = new Set<string>()
  for (const r of RESOURCES) {
    assert(!seen.has(r.resource), `duplicate resource slug: ${r.resource}`)
    seen.add(r.resource)
  }
})

Deno.test('у каждого ресурса есть правило скоупинга по салону', () => {
  for (const r of RESOURCES) {
    const scoped = !!r.salonColumn || !!r.parentScope || !!r.bankScope || r.kind === 'rpc'
    assert(scoped, `resource ${r.resource} has no salon-scoping rule`)
  }
})

Deno.test('create/update не содержат server-managed/секретных полей', () => {
  for (const r of RESOURCES) {
    for (const col of [...r.create, ...r.update]) {
      assert(
        !FORBIDDEN_IN_WRITE.includes(col),
        `resource ${r.resource} exposes forbidden writable column: ${col}`,
      )
    }
  }
})

Deno.test('read-колонки не похожи на секреты', () => {
  for (const r of RESOURCES) {
    for (const col of r.read) {
      for (const bad of SECRET_SUBSTRINGS) {
        assert(!col.includes(bad), `resource ${r.resource} read column looks secret: ${col}`)
      }
    }
  }
})

Deno.test('required ⊆ create; money ⊆ read', () => {
  for (const r of RESOURCES) {
    for (const req of r.required) {
      assert(r.create.includes(req), `resource ${r.resource}: required ${req} not in create`)
    }
    for (const m of r.money) {
      assert(r.read.includes(m), `resource ${r.resource}: money ${m} not in read`)
    }
  }
})

Deno.test('писать можно только в напрямую salon-scoped таблицы', () => {
  for (const r of RESOURCES) {
    const writable = r.create.length > 0 || r.update.length > 0 || r.allowDelete
    if (writable) {
      assertEquals(r.kind, 'table', `${r.resource} writable but not a table`)
      assert(!!r.salonColumn, `${r.resource} writable but not directly salon-scoped`)
    }
  }
})

Deno.test('rpc-ресурсы read-only и имеют rpc-конфиг', () => {
  for (const r of RESOURCES.filter((x) => x.kind === 'rpc')) {
    assertEquals(r.create.length, 0)
    assertEquals(r.update.length, 0)
    assertEquals(r.allowDelete, false)
    assert(!!r.rpc, `${r.resource} rpc kind without rpc config`)
    assert(!!r.rpc!.fn && !!r.rpc!.salonArg)
  }
})

Deno.test('parent-scoped ресурсы read-only', () => {
  for (const r of RESOURCES.filter((x) => x.parentScope || x.bankScope)) {
    assertEquals(r.create.length, 0, `${r.resource} parent/bank-scoped must be read-only`)
    assertEquals(r.update.length, 0)
    assertEquals(r.allowDelete, false)
  }
})

Deno.test('buildCatalog: методы и поля согласованы', () => {
  const cat = buildCatalog()
  assertEquals(cat.version, 'v1')
  assert(cat.resources.length === RESOURCES.length)
  for (const r of cat.resources) {
    assert(r.methods.includes('GET'))
    assert(typeof r.path === 'string' && r.path.startsWith('/v1/'))
  }
  // media-posts и любые секреты не должны попасть в каталог
  assert(!cat.resources.some((r) => r.resource === 'media-posts'))
})
