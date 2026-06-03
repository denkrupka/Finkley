import { describe, expect, it } from 'vitest'

import {
  findFirstMatch,
  matchRule,
  ruleAppliesToTx,
  ruleConditionsMatch,
  type RuleLike,
  type RuleTxLike,
} from './bank-rule-match'

function makeRule(over: Partial<RuleLike> = {}): RuleLike {
  return {
    enabled: true,
    applies_to: 'expense',
    conditions: [{ field: 'counterparty', op: 'contains', value: 'FACEBOOK' }],
    actions: [],
    ...over,
  }
}

function makeTx(over: Partial<RuleTxLike> = {}): RuleTxLike {
  return {
    type: 'debit',
    counterparty: 'FACEBOOK',
    description: 'FACEBK ad payment',
    amount_cents: -50000,
    ...over,
  }
}

describe('ruleAppliesToTx', () => {
  it('disabled rule never applies', () => {
    expect(ruleAppliesToTx(makeRule({ enabled: false }), makeTx())).toBe(false)
  })

  it('applies_to=both matches both directions', () => {
    const rule = makeRule({ applies_to: 'both' })
    expect(ruleAppliesToTx(rule, makeTx({ type: 'debit' }))).toBe(true)
    expect(ruleAppliesToTx(rule, makeTx({ type: 'credit' }))).toBe(true)
  })

  it('applies_to=income skips debit', () => {
    const rule = makeRule({ applies_to: 'income' })
    expect(ruleAppliesToTx(rule, makeTx({ type: 'debit' }))).toBe(false)
    expect(ruleAppliesToTx(rule, makeTx({ type: 'credit' }))).toBe(true)
  })

  it('applies_to=expense skips credit', () => {
    const rule = makeRule({ applies_to: 'expense' })
    expect(ruleAppliesToTx(rule, makeTx({ type: 'credit' }))).toBe(false)
    expect(ruleAppliesToTx(rule, makeTx({ type: 'debit' }))).toBe(true)
  })
})

describe('ruleConditionsMatch — text ops', () => {
  it('contains is case-insensitive', () => {
    const rule = makeRule({
      conditions: [{ field: 'counterparty', op: 'contains', value: 'facebook' }],
    })
    expect(ruleConditionsMatch(rule, makeTx({ counterparty: 'FACEBOOK Ireland' }))).toBe(true)
  })

  it('not_contains negates', () => {
    const rule = makeRule({
      conditions: [{ field: 'description', op: 'not_contains', value: 'BLIK' }],
    })
    expect(ruleConditionsMatch(rule, makeTx({ description: 'FACEBK ad' }))).toBe(true)
    expect(ruleConditionsMatch(rule, makeTx({ description: 'Przelew BLIK na telefon' }))).toBe(
      false,
    )
  })

  it('equals — strict (case-insensitive)', () => {
    const rule = makeRule({
      conditions: [{ field: 'counterparty', op: 'equals', value: 'facebook' }],
    })
    expect(ruleConditionsMatch(rule, makeTx({ counterparty: 'FACEBOOK' }))).toBe(true)
    expect(ruleConditionsMatch(rule, makeTx({ counterparty: 'FACEBOOK Ireland' }))).toBe(false)
  })

  it('starts_with / ends_with', () => {
    const start = makeRule({
      conditions: [{ field: 'counterparty', op: 'starts_with', value: 'Ene' }],
    })
    expect(ruleConditionsMatch(start, makeTx({ counterparty: 'Enea Sales' }))).toBe(true)
    const end = makeRule({
      conditions: [{ field: 'description', op: 'ends_with', value: 'telefon' }],
    })
    expect(ruleConditionsMatch(end, makeTx({ description: 'Przelew BLIK na telefon' }))).toBe(true)
  })

  it('regex op compiles user-provided pattern (case-insensitive)', () => {
    const rule = makeRule({
      conditions: [{ field: 'counterparty', op: 'regex', value: '^SHELL\\b' }],
    })
    expect(ruleConditionsMatch(rule, makeTx({ counterparty: 'SHELL Wrzesnia' }))).toBe(true)
    expect(ruleConditionsMatch(rule, makeTx({ counterparty: 'SHELLY' }))).toBe(false)
  })

  it('regex op with invalid pattern returns false (does not throw)', () => {
    const rule = makeRule({
      conditions: [{ field: 'counterparty', op: 'regex', value: '[unterminated' }],
    })
    expect(() => ruleConditionsMatch(rule, makeTx())).not.toThrow()
    expect(ruleConditionsMatch(rule, makeTx({ counterparty: 'whatever' }))).toBe(false)
  })

  it('null counterparty/description handled gracefully', () => {
    const rule = makeRule({
      conditions: [{ field: 'counterparty', op: 'contains', value: 'X' }],
    })
    expect(ruleConditionsMatch(rule, makeTx({ counterparty: null }))).toBe(false)
  })
})

describe('ruleConditionsMatch — number ops', () => {
  it('amount uses signed value (debit < 0)', () => {
    const rule = makeRule({
      conditions: [{ field: 'amount', op: 'lt', value: 0 }],
    })
    expect(ruleConditionsMatch(rule, makeTx({ amount_cents: -10000 }))).toBe(true)
    expect(ruleConditionsMatch(rule, makeTx({ amount_cents: 10000 }))).toBe(false)
  })

  it('amount_abs uses absolute value (for crowing big purchases)', () => {
    const rule = makeRule({
      conditions: [{ field: 'amount_abs', op: 'gte', value: 50000 }],
    })
    expect(ruleConditionsMatch(rule, makeTx({ amount_cents: -75000 }))).toBe(true)
    expect(ruleConditionsMatch(rule, makeTx({ amount_cents: -25000 }))).toBe(false)
    expect(ruleConditionsMatch(rule, makeTx({ amount_cents: 75000 }))).toBe(true)
  })

  it('equals/lt/lte/gt/gte', () => {
    const eq = makeRule({ conditions: [{ field: 'amount_abs', op: 'equals', value: 10000 }] })
    expect(ruleConditionsMatch(eq, makeTx({ amount_cents: -10000 }))).toBe(true)
    expect(ruleConditionsMatch(eq, makeTx({ amount_cents: -10001 }))).toBe(false)
    const lte = makeRule({ conditions: [{ field: 'amount_abs', op: 'lte', value: 10000 }] })
    expect(ruleConditionsMatch(lte, makeTx({ amount_cents: -10000 }))).toBe(true)
    expect(ruleConditionsMatch(lte, makeTx({ amount_cents: -10001 }))).toBe(false)
  })
})

describe('multi-condition AND', () => {
  it('matches when all conditions hold', () => {
    const rule = makeRule({
      conditions: [
        { field: 'counterparty', op: 'contains', value: 'TRANSGOURMET' },
        { field: 'amount_abs', op: 'gte', value: 50000 },
      ],
    })
    expect(
      ruleConditionsMatch(
        rule,
        makeTx({ counterparty: 'TRANSGOURMET Poznan', amount_cents: -75000 }),
      ),
    ).toBe(true)
  })

  it('fails when any condition fails', () => {
    const rule = makeRule({
      conditions: [
        { field: 'counterparty', op: 'contains', value: 'TRANSGOURMET' },
        { field: 'amount_abs', op: 'gte', value: 100000 },
      ],
    })
    expect(
      ruleConditionsMatch(
        rule,
        makeTx({ counterparty: 'TRANSGOURMET Poznan', amount_cents: -50000 }),
      ),
    ).toBe(false)
  })

  it('empty conditions array — НЕ матч (защита от пустого правила)', () => {
    const rule = makeRule({ conditions: [] })
    expect(ruleConditionsMatch(rule, makeTx())).toBe(false)
  })
})

describe('matchRule (full pipeline)', () => {
  it('disabled rule fails fast', () => {
    expect(matchRule(makeRule({ enabled: false }), makeTx())).toBe(false)
  })

  it('applies_to filter + conditions both must pass', () => {
    const rule = makeRule({
      applies_to: 'income',
      conditions: [{ field: 'counterparty', op: 'contains', value: 'ZUS' }],
    })
    expect(matchRule(rule, makeTx({ type: 'debit', counterparty: 'ZUS' }))).toBe(false)
    expect(matchRule(rule, makeTx({ type: 'credit', counterparty: 'ZUS return' }))).toBe(true)
  })
})

describe('findFirstMatch', () => {
  it('returns first by array order (caller sorts by sort_order/created_at)', () => {
    const a = makeRule({
      conditions: [{ field: 'counterparty', op: 'contains', value: 'SHELL' }],
    })
    const b = makeRule({
      conditions: [{ field: 'counterparty', op: 'contains', value: 'SHELL Wrzesnia' }],
    })
    expect(findFirstMatch([a, b], makeTx({ counterparty: 'SHELL Wrzesnia POL' }))).toBe(a)
    expect(findFirstMatch([b, a], makeTx({ counterparty: 'SHELL Wrzesnia POL' }))).toBe(b)
  })

  it('returns null when nothing matches', () => {
    const rule = makeRule({
      conditions: [{ field: 'counterparty', op: 'contains', value: 'NOPE' }],
    })
    expect(findFirstMatch([rule], makeTx())).toBe(null)
  })

  it('skips disabled rules', () => {
    const disabled = makeRule({
      enabled: false,
      conditions: [{ field: 'counterparty', op: 'contains', value: 'FACEBOOK' }],
    })
    const enabled = makeRule({
      conditions: [{ field: 'counterparty', op: 'contains', value: 'FACEBOOK' }],
    })
    expect(findFirstMatch([disabled, enabled], makeTx())).toBe(enabled)
  })
})
