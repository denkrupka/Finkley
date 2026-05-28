/**
 * T201 — pure helper для логики добавления нового item в иерархическую
 * категорию (investments/flows/balance). Выделено чтобы юнит-тестировать.
 *
 * Контракт: для иерархических категорий новый item получает parent_id =
 * первого header'a (item без parent_id) из списка. Если override задан —
 * используется он. Если иерархия пуста — parent_id остаётся undefined
 * и item попадает в root (юзер увидит явно где он).
 */

export type MinimalItem = {
  id: string
  parent_id?: string | null
}

export type HierarchicalCategory = 'investments' | 'flows' | 'balance'

export function isHierarchicalCategory(cat: string): cat is HierarchicalCategory {
  return cat === 'investments' || cat === 'flows' || cat === 'balance'
}

export function pickDefaultParentId(
  items: ReadonlyArray<MinimalItem>,
  category: string,
  override?: string,
): string | undefined {
  if (override) return override
  if (!isHierarchicalCategory(category)) return undefined
  const firstHeader = items.find((it) => !it.parent_id)
  return firstHeader?.id
}
