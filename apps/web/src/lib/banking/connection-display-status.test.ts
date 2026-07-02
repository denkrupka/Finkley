import { describe, expect, it } from 'vitest'

import { bankDisplayStatus, type BankConnectionStatusLike } from './connection-display-status'

function conn(
  status: BankConnectionStatusLike['status'],
  createdAt: string,
  lastError: string | null = null,
): BankConnectionStatusLike {
  return { status, created_at: createdAt, last_error: lastError }
}

describe('bankDisplayStatus', () => {
  it('пустой список → none', () => {
    expect(bankDisplayStatus([])).toEqual({ kind: 'none' })
  })

  it('connected среди прочих → connected', () => {
    expect(
      bankDisplayStatus([
        conn('error', '2026-07-02T10:00:00+00:00', 'boom'),
        conn('connected', '2026-07-01T10:00:00+00:00'),
      ]),
    ).toEqual({ kind: 'connected' })
  })

  it('одинокий pending — это НЕ подключение (незавершённый redirect-flow)', () => {
    expect(bankDisplayStatus([conn('pending', '2026-07-02T10:00:00+00:00')])).toEqual({
      kind: 'none',
    })
  })

  it('последняя попытка error → error с last_error', () => {
    expect(
      bankDisplayStatus([
        conn('pending', '2026-07-01T10:00:00+00:00'),
        conn('error', '2026-07-02T10:00:00+00:00', 'bank_denied'),
      ]),
    ).toEqual({ kind: 'error', lastError: 'bank_denied' })
  })

  it('error перекрыт новым pending (юзер пробует снова) → none, не пугаем', () => {
    expect(
      bankDisplayStatus([
        conn('error', '2026-07-01T10:00:00+00:00', 'bank_denied'),
        conn('pending', '2026-07-02T10:00:00+00:00'),
      ]),
    ).toEqual({ kind: 'none' })
  })

  it('не зависит от порядка элементов (сортируем по created_at сами)', () => {
    const a = conn('error', '2026-07-02T10:00:00+00:00', 'x')
    const b = conn('pending', '2026-07-01T10:00:00+00:00')
    expect(bankDisplayStatus([a, b])).toEqual(bankDisplayStatus([b, a]))
  })

  it('expired → none (нужно переподключение, но это не ошибка попытки)', () => {
    expect(bankDisplayStatus([conn('expired', '2026-07-02T10:00:00+00:00')])).toEqual({
      kind: 'none',
    })
  })

  it('error без last_error → lastError: null', () => {
    expect(bankDisplayStatus([conn('error', '2026-07-02T10:00:00+00:00')])).toEqual({
      kind: 'error',
      lastError: null,
    })
  })
})
