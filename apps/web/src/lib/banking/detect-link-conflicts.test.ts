/**
 * Unit-тесты для detectMultiLinkConflicts.
 */
import { describe, expect, it } from 'vitest'

import {
  detectMultiLinkConflicts,
  type ExistingLegacyFk,
  type ExistingSplit,
  type RequestedSplit,
} from './detect-link-conflicts'

const CURRENT_TX = 'tx-current'
const OTHER_TX = 'tx-other'

describe('detectMultiLinkConflicts', () => {
  it('пустые existing → нет конфликта', () => {
    const requested: RequestedSplit[] = [{ kind: 'expense', entityId: 'e1', amountCents: 1000 }]
    const res = detectMultiLinkConflicts([], [], requested, CURRENT_TX)
    expect(res.hasConflict).toBe(false)
    expect(res.conflictEntityIds).toEqual([])
  })

  it('split на той же tx → не конфликт (renew)', () => {
    const splits: ExistingSplit[] = [
      { bank_transaction_id: CURRENT_TX, kind: 'expense', entity_id: 'e1' },
    ]
    const requested: RequestedSplit[] = [{ kind: 'expense', entityId: 'e1', amountCents: 1000 }]
    const res = detectMultiLinkConflicts(splits, [], requested, CURRENT_TX)
    expect(res.hasConflict).toBe(false)
  })

  it('split на другой tx + тот же entity → конфликт', () => {
    const splits: ExistingSplit[] = [
      { bank_transaction_id: OTHER_TX, kind: 'expense', entity_id: 'e1' },
    ]
    const requested: RequestedSplit[] = [{ kind: 'expense', entityId: 'e1', amountCents: 1000 }]
    const res = detectMultiLinkConflicts(splits, [], requested, CURRENT_TX)
    expect(res.hasConflict).toBe(true)
    expect(res.conflictEntityIds).toEqual(['e1'])
  })

  it('legacy FK на другой tx → конфликт', () => {
    const fks: ExistingLegacyFk[] = [
      { bank_transaction_id: OTHER_TX, kind: 'visit', entity_id: 'v1' },
    ]
    const requested: RequestedSplit[] = [{ kind: 'visit', entityId: 'v1', amountCents: 5000 }]
    const res = detectMultiLinkConflicts([], fks, requested, CURRENT_TX)
    expect(res.hasConflict).toBe(true)
    expect(res.conflictEntityIds).toEqual(['v1'])
  })

  it('тот же entity_id но разные kind → не конфликт (разные таблицы)', () => {
    // Маловероятно (UUID должны быть уникальны между таблицами), но логика правильна
    const splits: ExistingSplit[] = [
      { bank_transaction_id: OTHER_TX, kind: 'expense', entity_id: 'same-uuid' },
    ]
    const requested: RequestedSplit[] = [
      { kind: 'visit', entityId: 'same-uuid', amountCents: 1000 },
    ]
    const res = detectMultiLinkConflicts(splits, [], requested, CURRENT_TX)
    expect(res.hasConflict).toBe(false)
  })

  it('несколько конфликтов одновременно — все entity_id в conflictEntityIds', () => {
    const splits: ExistingSplit[] = [
      { bank_transaction_id: OTHER_TX, kind: 'expense', entity_id: 'e1' },
    ]
    const fks: ExistingLegacyFk[] = [
      { bank_transaction_id: 'tx-third', kind: 'visit', entity_id: 'v1' },
    ]
    const requested: RequestedSplit[] = [
      { kind: 'expense', entityId: 'e1', amountCents: 1000 },
      { kind: 'visit', entityId: 'v1', amountCents: 2000 },
      { kind: 'other_income', entityId: 'o1', amountCents: 500 }, // нет конфликта
    ]
    const res = detectMultiLinkConflicts(splits, fks, requested, CURRENT_TX)
    expect(res.hasConflict).toBe(true)
    expect(res.conflictEntityIds.sort()).toEqual(['e1', 'v1'])
  })

  it('конфликт через split + через FK на ту же entity → дедуплицируется', () => {
    const splits: ExistingSplit[] = [
      { bank_transaction_id: OTHER_TX, kind: 'expense', entity_id: 'e1' },
    ]
    const fks: ExistingLegacyFk[] = [
      { bank_transaction_id: 'tx-third', kind: 'expense', entity_id: 'e1' },
    ]
    const requested: RequestedSplit[] = [{ kind: 'expense', entityId: 'e1', amountCents: 1000 }]
    const res = detectMultiLinkConflicts(splits, fks, requested, CURRENT_TX)
    expect(res.hasConflict).toBe(true)
    expect(res.conflictEntityIds).toEqual(['e1']) // не задвоен
  })

  it('FK на той же tx + другой entity → не конфликт', () => {
    const fks: ExistingLegacyFk[] = [
      { bank_transaction_id: CURRENT_TX, kind: 'expense', entity_id: 'e1' },
    ]
    const requested: RequestedSplit[] = [{ kind: 'expense', entityId: 'e1', amountCents: 1000 }]
    const res = detectMultiLinkConflicts([], fks, requested, CURRENT_TX)
    expect(res.hasConflict).toBe(false)
  })

  it('requested entity вообще не пересекается с existing → нет конфликта', () => {
    const splits: ExistingSplit[] = [
      { bank_transaction_id: OTHER_TX, kind: 'expense', entity_id: 'e1' },
    ]
    const requested: RequestedSplit[] = [{ kind: 'expense', entityId: 'e2', amountCents: 1000 }]
    const res = detectMultiLinkConflicts(splits, [], requested, CURRENT_TX)
    expect(res.hasConflict).toBe(false)
  })
})
