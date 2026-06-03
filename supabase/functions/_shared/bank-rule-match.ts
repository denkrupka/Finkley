/**
 * ADR-031: pure-функция матчера bank_tx_rules для Edge Functions (Deno).
 *
 * Зеркало `apps/web/src/lib/banking/bank-rule-match.ts` — поддерживай
 * синхронизацию руками. Логика должна совпадать 1:1.
 */

export type RuleAppliesTo = 'income' | 'expense' | 'both'

export type RuleCondition =
  | { field: 'counterparty'; op: RuleTextOp; value: string }
  | { field: 'description'; op: RuleTextOp; value: string }
  | { field: 'amount'; op: RuleNumberOp; value: number }
  | { field: 'amount_abs'; op: RuleNumberOp; value: number }

export type RuleTextOp =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'starts_with'
  | 'ends_with'
  | 'regex'

export type RuleNumberOp = 'equals' | 'gt' | 'gte' | 'lt' | 'lte'

export type RuleAction =
  | { type: 'set_category'; category_id: string }
  | { type: 'set_counterparty'; counterparty: string }
  | { type: 'ignore' }

export type RuleLike = {
  enabled: boolean
  applies_to: RuleAppliesTo
  conditions: RuleCondition[]
  actions: RuleAction[]
}

export type RuleTxLike = {
  type: 'credit' | 'debit'
  counterparty: string | null
  description: string | null
  amount_cents: number
}

export function ruleAppliesToTx(rule: RuleLike, tx: RuleTxLike): boolean {
  if (!rule.enabled) return false
  if (rule.applies_to === 'both') return true
  if (rule.applies_to === 'income' && tx.type === 'credit') return true
  if (rule.applies_to === 'expense' && tx.type === 'debit') return true
  return false
}

export function ruleConditionsMatch(rule: RuleLike, tx: RuleTxLike): boolean {
  if (rule.conditions.length === 0) return false
  return rule.conditions.every((c) => conditionMatches(c, tx))
}

export function matchRule(rule: RuleLike, tx: RuleTxLike): boolean {
  if (!ruleAppliesToTx(rule, tx)) return false
  return ruleConditionsMatch(rule, tx)
}

function conditionMatches(c: RuleCondition, tx: RuleTxLike): boolean {
  if (c.field === 'counterparty' || c.field === 'description') {
    const raw = c.field === 'counterparty' ? tx.counterparty : tx.description
    const haystack = (raw ?? '').toLowerCase()
    const needle = c.value.toLowerCase()
    return textOpMatches(c.op, haystack, needle, c.value)
  }
  const lhs = c.field === 'amount_abs' ? Math.abs(tx.amount_cents) : tx.amount_cents
  return numberOpMatches(c.op, lhs, c.value)
}

function textOpMatches(
  op: RuleTextOp,
  haystack: string,
  needleLower: string,
  rawNeedle: string,
): boolean {
  switch (op) {
    case 'contains':
      return haystack.includes(needleLower)
    case 'not_contains':
      return !haystack.includes(needleLower)
    case 'equals':
      return haystack === needleLower
    case 'starts_with':
      return haystack.startsWith(needleLower)
    case 'ends_with':
      return haystack.endsWith(needleLower)
    case 'regex':
      try {
        return new RegExp(rawNeedle, 'i').test(haystack)
      } catch {
        return false
      }
  }
}

function numberOpMatches(op: RuleNumberOp, lhs: number, rhs: number): boolean {
  switch (op) {
    case 'equals':
      return lhs === rhs
    case 'gt':
      return lhs > rhs
    case 'gte':
      return lhs >= rhs
    case 'lt':
      return lhs < rhs
    case 'lte':
      return lhs <= rhs
  }
}

export function findFirstMatch<R extends RuleLike>(rules: R[], tx: RuleTxLike): R | null {
  for (const r of rules) {
    if (matchRule(r, tx)) return r
  }
  return null
}
