import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { detectCountryByIp } from './detect-country'

const originalFetch = globalThis.fetch

describe('detectCountryByIp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('возвращает поддерживаемую страну если ipapi отвечает кодом', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => 'CZ',
    })) as unknown as typeof fetch
    const result = await detectCountryByIp()
    expect(result).toBe('CZ')
  })

  it('тримит whitespace и переводит в верхний регистр', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '  de\n',
    })) as unknown as typeof fetch
    const result = await detectCountryByIp()
    expect(result).toBe('DE')
  })

  it('возвращает null для не-поддерживаемой страны', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => 'US',
    })) as unknown as typeof fetch
    const result = await detectCountryByIp()
    expect(result).toBeNull()
  })

  it('возвращает null если ipapi отвечает non-ok статусом', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      text: async () => 'rate limited',
    })) as unknown as typeof fetch
    const result = await detectCountryByIp()
    expect(result).toBeNull()
  })

  it('возвращает null при выбросе исключения (network/timeout)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network')
    }) as unknown as typeof fetch
    const result = await detectCountryByIp()
    expect(result).toBeNull()
  })

  it('возвращает null для каждой поддерживаемой страны корректно', async () => {
    for (const code of ['PL', 'DE', 'LT', 'CZ', 'EE']) {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        text: async () => code,
      })) as unknown as typeof fetch
      const result = await detectCountryByIp()
      expect(result).toBe(code)
    }
  })
})
