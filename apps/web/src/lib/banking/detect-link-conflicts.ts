/**
 * Pure-helper: определяет конфликты при multi-link bank-tx → N сущностей.
 *
 * Конфликт = одна из выбранных сущностей уже связана с другой банковской
 * транзакцией через splits или legacy FK (expense_id/linked_visit_id/
 * linked_other_income_id). Если связь с текущей tx — это renew, не конфликт.
 *
 * Изначально логика жила inline в useMultiLinkBankTransaction (см. ADR-026
 * слой 4 + commit 488bb9c). Вынесено в pure helper чтобы можно было
 * тестировать без подключения к Supabase.
 */

export type SplitKind = 'expense' | 'visit' | 'other_income'

export type ExistingSplit = {
  bank_transaction_id: string
  kind: SplitKind
  entity_id: string
}

export type ExistingLegacyFk = {
  bank_transaction_id: string
  kind: SplitKind
  entity_id: string
}

export type RequestedSplit = {
  kind: SplitKind
  entityId: string
  amountCents: number
}

export type ConflictResult = {
  hasConflict: boolean
  conflictEntityIds: string[]
}

/**
 * @param existingSplits — все splits в БД для пересекающихся entityId (можно
 *   передать суженный список, но логика валидна и при полной выборке).
 * @param existingLegacyFks — bank_transactions с непустыми FK (expense_id,
 *   linked_visit_id, linked_other_income_id), приведённые в общую форму.
 * @param requestedSplits — что юзер хочет связать с currentTxId.
 * @param currentTxId — tx, к которой юзер привязывает (не считается конфликтом).
 */
export function detectMultiLinkConflicts(
  existingSplits: ExistingSplit[],
  existingLegacyFks: ExistingLegacyFk[],
  requestedSplits: RequestedSplit[],
  currentTxId: string,
): ConflictResult {
  const requested = new Set<string>()
  for (const r of requestedSplits) requested.add(`${r.kind}:${r.entityId}`)

  const conflictIds = new Set<string>()

  for (const s of existingSplits) {
    if (s.bank_transaction_id === currentTxId) continue // та же tx — не конфликт
    if (requested.has(`${s.kind}:${s.entity_id}`)) conflictIds.add(s.entity_id)
  }
  for (const fk of existingLegacyFks) {
    if (fk.bank_transaction_id === currentTxId) continue
    if (requested.has(`${fk.kind}:${fk.entity_id}`)) conflictIds.add(fk.entity_id)
  }

  return {
    hasConflict: conflictIds.size > 0,
    conflictEntityIds: Array.from(conflictIds),
  }
}
