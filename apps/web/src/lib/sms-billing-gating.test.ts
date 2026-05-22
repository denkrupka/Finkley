/**
 * Shadow-тесты для supabase/functions/_shared/sms-billing.ts —
 * critical gating logic (paused / no-balance / sender override).
 *
 * Тестируем pure-логику решения «слать или нет» — отдельно от реальных
 * Supabase/SMSAPI вызовов. Любая регрессия здесь = неконтролируемые
 * списания с баланса салона или, наоборот, тихое отсутствие отправки.
 */
import { describe, expect, it } from 'vitest'

type SalonRow = {
  sms_balance: number
  sms_paused: boolean
  sms_active_sender_id: string | null
}

type GateResult =
  | { allowed: true; sender: string }
  | { allowed: false; reason: 'skipped_paused' | 'skipped_no_balance' }

const DEFAULT_SENDER = 'FINKLEY'

function gateSendDecision(salon: SalonRow, activeSenderName: string | null): GateResult {
  if (salon.sms_paused) return { allowed: false, reason: 'skipped_paused' }
  if (salon.sms_balance < 1) return { allowed: false, reason: 'skipped_no_balance' }
  return { allowed: true, sender: activeSenderName ?? DEFAULT_SENDER }
}

const LOW_BALANCE_THRESHOLD = 2
function shouldNotifyLow(newBalance: number): boolean {
  return newBalance <= LOW_BALANCE_THRESHOLD
}

describe('sms-billing gating — критическая логика «слать или нет»', () => {
  it('paused=true → НЕ слать (приоритет выше balance)', () => {
    expect(
      gateSendDecision({ sms_balance: 100, sms_paused: true, sms_active_sender_id: null }, null),
    ).toEqual({ allowed: false, reason: 'skipped_paused' })
  })

  it('paused=false + balance=0 → НЕ слать (no balance)', () => {
    expect(
      gateSendDecision({ sms_balance: 0, sms_paused: false, sms_active_sender_id: null }, null),
    ).toEqual({ allowed: false, reason: 'skipped_no_balance' })
  })

  it('balance=1 → слать (граница ровно 1 — последний SMS ещё уходит)', () => {
    const r = gateSendDecision(
      { sms_balance: 1, sms_paused: false, sms_active_sender_id: null },
      null,
    )
    expect(r.allowed).toBe(true)
  })

  it('balance=10, paused=false → слать с дефолтным FINKLEY если нет sender', () => {
    const r = gateSendDecision(
      { sms_balance: 10, sms_paused: false, sms_active_sender_id: null },
      null,
    )
    expect(r).toEqual({ allowed: true, sender: 'FINKLEY' })
  })

  it('balance=10, active sender = MYSALON → use MYSALON', () => {
    const r = gateSendDecision(
      { sms_balance: 10, sms_paused: false, sms_active_sender_id: 'uuid-1' },
      'MYSALON',
    )
    expect(r).toEqual({ allowed: true, sender: 'MYSALON' })
  })

  it('active_sender_id задан, но resolved name = null → fallback на FINKLEY', () => {
    // Возникает если sender удалили из БД или статус не active.
    // Не должны слать с битым sender name.
    const r = gateSendDecision(
      { sms_balance: 10, sms_paused: false, sms_active_sender_id: 'uuid-1' },
      null,
    )
    expect(r).toEqual({ allowed: true, sender: 'FINKLEY' })
  })

  it('paused + balance=0 → reason="skipped_paused" (paused приоритетнее)', () => {
    // Регрессия: если оба условия — лог должен показывать что причина пауза
    // (юзер сам остановил), а не «закончились» (нужно идти покупать).
    const r = gateSendDecision(
      { sms_balance: 0, sms_paused: true, sms_active_sender_id: null },
      null,
    )
    expect(r).toEqual({ allowed: false, reason: 'skipped_paused' })
  })
})

describe('low-balance notify threshold', () => {
  it('balance=3 → НЕ уведомлять (порог ≤2)', () => {
    expect(shouldNotifyLow(3)).toBe(false)
  })

  it('balance=2 → уведомлять (граница включительно)', () => {
    expect(shouldNotifyLow(2)).toBe(true)
  })

  it('balance=1 → уведомлять', () => {
    expect(shouldNotifyLow(1)).toBe(true)
  })

  it('balance=0 → уведомлять (закончились)', () => {
    expect(shouldNotifyLow(0)).toBe(true)
  })

  it('balance отрицательный (не должно быть, но защитимся) → уведомлять', () => {
    expect(shouldNotifyLow(-1)).toBe(true)
  })
})
