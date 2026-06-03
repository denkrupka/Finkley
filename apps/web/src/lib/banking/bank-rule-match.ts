import type { RuleAction, RuleAppliesTo, RuleCondition } from './bank-rule-schema'

/**
 * ADR-031: pure-функция матчера для bank_tx_rules.
 *
 * Используется в UI (preview правила, опционально) и переписана 1:1 в
 * `supabase/functions/banking-sync/index.ts::applyBankTxRules`. Если
 * меняешь логику здесь — синхронизируй там же.
 */

export type RuleTxLike = {
  /** 'credit' (income) | 'debit' (expense) */
  type: 'credit' | 'debit'
  counterparty: string | null
  description: string | null
  /** В центах. Может быть отрицательным или положительным — bank-зависимо. */
  amount_cents: number
}

export type RuleLike = {
  enabled: boolean
  applies_to: RuleAppliesTo
  conditions: RuleCondition[]
  actions: RuleAction[]
}

/**
 * Применимо ли правило к транзакции вообще (без проверки conditions)?
 * Учитывает enabled и applies_to.
 */
export function ruleAppliesToTx(rule: RuleLike, tx: RuleTxLike): boolean {
  if (!rule.enabled) return false
  if (rule.applies_to === 'both') return true
  if (rule.applies_to === 'income' && tx.type === 'credit') return true
  if (rule.applies_to === 'expense' && tx.type === 'debit') return true
  return false
}

/**
 * Все ли conditions правила проходят на транзакции (AND)?
 *
 * Пустой массив conditions трактуется как НЕ матч (защита от
 * случайно созданного правила без условий, которое схватило бы всё
 * подряд). UI запрещает min(1) conditions, но в БД через прямой SQL
 * можно вставить пустой массив — на всякий случай страхуемся.
 */
export function ruleConditionsMatch(rule: RuleLike, tx: RuleTxLike): boolean {
  if (rule.conditions.length === 0) return false
  return rule.conditions.every((c) => conditionMatches(c, tx))
}

/**
 * Полный матч: applies_to + enabled + все conditions.
 */
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
  // amount / amount_abs
  const lhs = c.field === 'amount_abs' ? Math.abs(tx.amount_cents) : tx.amount_cents
  return numberOpMatches(c.op, lhs, c.value)
}

function textOpMatches(
  op: RuleCondition extends { op: infer O } ? O : never,
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
    default:
      return false
  }
}

function numberOpMatches(
  op: RuleCondition extends { op: infer O } ? O : never,
  lhs: number,
  rhs: number,
): boolean {
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
    default:
      return false
  }
}

/**
 * Найти первое матчащееся правило из отсортированного списка.
 * Правила должны прийти уже в порядке `sort_order asc, created_at asc`.
 */
export function findFirstMatch<R extends RuleLike>(rules: R[], tx: RuleTxLike): R | null {
  for (const r of rules) {
    if (matchRule(r, tx)) return r
  }
  return null
}
