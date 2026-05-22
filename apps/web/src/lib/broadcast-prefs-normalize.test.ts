/**
 * Shadow-тест для apps/web/src/hooks/useBroadcastPrefs.ts::normalize +
 * supabase/functions/_shared/broadcast-prefs.ts::getBroadcastChannels.
 *
 * Критично: с миграции 20260521000023 дефолт ВЫКЛЮЧЕН для всех каналов.
 * Если normalize вернёт true где должно быть false — клиенты получат
 * SMS которые не разрешали слать. Регрессионный тест на «safe-by-default».
 */
import { describe, expect, it } from 'vitest'

type BroadcastKind = 'marketing' | 'visit_reminder' | 'review_request'
type ChannelPrefs = { email: boolean; sms: boolean }
type BroadcastPrefs = Record<BroadcastKind, ChannelPrefs>

const BROADCAST_KINDS: BroadcastKind[] = ['marketing', 'visit_reminder', 'review_request']

function normalize(raw: unknown): BroadcastPrefs {
  const out: BroadcastPrefs = {
    marketing: { email: false, sms: false },
    visit_reminder: { email: false, sms: false },
    review_request: { email: false, sms: false },
  }
  if (!raw || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  for (const k of BROADCAST_KINDS) {
    const v = obj[k]
    if (v && typeof v === 'object') {
      const vv = v as Record<string, unknown>
      out[k] = {
        email: vv.email === true,
        sms: vv.sms === true,
      }
    }
  }
  return out
}

describe('broadcast prefs normalize — safe-by-default защита', () => {
  it('null/undefined → всё OFF', () => {
    const r = normalize(null)
    for (const k of BROADCAST_KINDS) {
      expect(r[k]).toEqual({ email: false, sms: false })
    }
  })

  it('пустой object → всё OFF', () => {
    const r = normalize({})
    for (const k of BROADCAST_KINDS) {
      expect(r[k]).toEqual({ email: false, sms: false })
    }
  })

  it('явный true для review_request.sms → только этот канал ON, остальные OFF', () => {
    const r = normalize({ review_request: { sms: true } })
    expect(r.review_request).toEqual({ email: false, sms: true })
    expect(r.marketing).toEqual({ email: false, sms: false })
    expect(r.visit_reminder).toEqual({ email: false, sms: false })
  })

  it('невалидный тип значения (string вместо bool) → OFF', () => {
    // Регрессия: если БД вернёт ошибочный JSON — не должны включать каналы.
    const r = normalize({ marketing: { sms: 'true', email: 1 } })
    expect(r.marketing).toEqual({ email: false, sms: false })
  })

  it('частичный prefs (только email задан) → sms остаётся OFF', () => {
    const r = normalize({ marketing: { email: true } })
    expect(r.marketing).toEqual({ email: true, sms: false })
  })

  it('лишние kinds в данных игнорируются (не падаем)', () => {
    const r = normalize({
      marketing: { sms: true, email: true },
      unknown_kind: { sms: true },
    })
    expect(r.marketing).toEqual({ email: true, sms: true })
    expect(BROADCAST_KINDS).not.toContain('unknown_kind')
  })

  it('массив вместо object → fallback all OFF', () => {
    const r = normalize([{ sms: true }])
    for (const k of BROADCAST_KINDS) {
      expect(r[k]).toEqual({ email: false, sms: false })
    }
  })
})
