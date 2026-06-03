import { z } from 'zod'

/**
 * ADR-031: Богатая модель bank_tx_rules.
 *
 * Z-схемы для условий/действий правила. Используются:
 *  - в UI редакторе правила (валидация формы);
 *  - в хуках useCreate/UpdateBankTxRule (валидация перед записью);
 *  - в pure-функции matchRule (нормализация на стороне Edge Function).
 */

export const ruleTextOps = [
  'contains',
  'not_contains',
  'equals',
  'starts_with',
  'ends_with',
  'regex',
] as const

export const ruleNumberOps = ['equals', 'gt', 'gte', 'lt', 'lte'] as const

export type RuleTextOp = (typeof ruleTextOps)[number]
export type RuleNumberOp = (typeof ruleNumberOps)[number]

export const ruleTextFields = ['counterparty', 'description'] as const
export const ruleNumberFields = ['amount', 'amount_abs'] as const

export type RuleTextField = (typeof ruleTextFields)[number]
export type RuleNumberField = (typeof ruleNumberFields)[number]

export const RuleConditionSchema = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('counterparty'),
    op: z.enum(ruleTextOps),
    value: z.string().min(1),
  }),
  z.object({
    field: z.literal('description'),
    op: z.enum(ruleTextOps),
    value: z.string().min(1),
  }),
  z.object({
    field: z.literal('amount'),
    op: z.enum(ruleNumberOps),
    value: z.number().int(),
  }),
  z.object({
    field: z.literal('amount_abs'),
    op: z.enum(ruleNumberOps),
    value: z.number().int().nonnegative(),
  }),
])
export type RuleCondition = z.infer<typeof RuleConditionSchema>

export const RuleActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_category'),
    category_id: z.string().uuid(),
  }),
  z.object({
    type: z.literal('set_counterparty'),
    counterparty: z.string().min(1),
  }),
  z.object({
    type: z.literal('ignore'),
  }),
])
export type RuleAction = z.infer<typeof RuleActionSchema>

export const ruleAppliesTo = ['income', 'expense', 'both'] as const
export type RuleAppliesTo = (typeof ruleAppliesTo)[number]

export const BankTxRuleInputSchema = z.object({
  name: z.string().trim().min(1, 'Введите имя правила').max(200),
  enabled: z.boolean(),
  applies_to: z.enum(ruleAppliesTo),
  conditions: z.array(RuleConditionSchema).min(1, 'Добавьте хотя бы одно условие'),
  actions: z.array(RuleActionSchema).min(1, 'Добавьте хотя бы одно действие'),
  sort_order: z.number().int().default(0),
})
export type BankTxRuleInput = z.infer<typeof BankTxRuleInputSchema>
