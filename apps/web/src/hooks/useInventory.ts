import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type InventoryItemRow = {
  id: string
  salon_id: string
  name: string
  unit: string
  sku: string | null
  category: string | null
  current_stock: number
  min_stock: number
  cost_per_unit_cents: number
  supplier: string | null
  is_archived: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type ServiceMaterialRow = {
  id: string
  service_id: string
  material_id: string
  quantity: number
  notes: string | null
  created_at: string
}

export type InventoryTxType =
  | 'purchase'
  | 'consumption'
  | 'manual_adjustment'
  | 'stocktake'
  | 'waste'

export type InventoryTransactionRow = {
  id: string
  salon_id: string
  material_id: string
  type: InventoryTxType
  quantity: number
  prev_stock: number | null
  cost_cents: number | null
  visit_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

const ITEM_FIELDS =
  'id, salon_id, name, unit, sku, category, current_stock, min_stock, cost_per_unit_cents, supplier, is_archived, notes, created_at, updated_at'

// =============================================================================
// Queries
// =============================================================================

export function useInventoryItems(
  salonId: string | undefined,
  opts?: { includeArchived?: boolean },
) {
  const includeArchived = opts?.includeArchived ?? false
  return useQuery<InventoryItemRow[]>({
    queryKey: ['inventory-items', salonId, { includeArchived }],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('inventory_items')
        .select(ITEM_FIELDS)
        .eq('salon_id', salonId)
        .order('name', { ascending: true })
      if (!includeArchived) q = q.eq('is_archived', false)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as InventoryItemRow[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useInventoryItem(itemId: string | undefined) {
  return useQuery<InventoryItemRow | null>({
    queryKey: ['inventory-items', 'one', itemId],
    queryFn: async () => {
      if (!itemId) return null
      const { data, error } = await supabase
        .from('inventory_items')
        .select(ITEM_FIELDS)
        .eq('id', itemId)
        .maybeSingle()
      if (error) throw error
      return data as InventoryItemRow | null
    },
    enabled: !!itemId,
    staleTime: 30_000,
  })
}

export function useInventoryTransactions(materialId: string | undefined, limit = 50) {
  return useQuery<InventoryTransactionRow[]>({
    queryKey: ['inventory-tx', materialId, limit],
    queryFn: async () => {
      if (!materialId) return []
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('material_id', materialId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as InventoryTransactionRow[]
    },
    enabled: !!materialId,
    staleTime: 15_000,
  })
}

/** Все материалы, в которых используется указанная услуга (recipe). */
export function useServiceRecipe(serviceId: string | undefined) {
  return useQuery<Array<ServiceMaterialRow & { material: InventoryItemRow | null }>>({
    queryKey: ['service-recipe', serviceId],
    queryFn: async () => {
      if (!serviceId) return []
      const { data, error } = await supabase
        .from('service_materials')
        .select(`*, material:inventory_items(${ITEM_FIELDS})`)
        .eq('service_id', serviceId)
      if (error) throw error
      type Row = ServiceMaterialRow & { material: InventoryItemRow | InventoryItemRow[] | null }
      return ((data ?? []) as Row[]).map((r) => ({
        ...r,
        material: Array.isArray(r.material) ? (r.material[0] ?? null) : r.material,
      }))
    },
    enabled: !!serviceId,
    staleTime: 60_000,
  })
}

/** Все услуги, в которых используется указанный материал (reverse recipe). */
export function useMaterialUsage(materialId: string | undefined) {
  return useQuery<Array<ServiceMaterialRow & { service: { id: string; name: string } | null }>>({
    queryKey: ['material-usage', materialId],
    queryFn: async () => {
      if (!materialId) return []
      const { data, error } = await supabase
        .from('service_materials')
        .select('*, service:services(id, name)')
        .eq('material_id', materialId)
      if (error) throw error
      type Row = ServiceMaterialRow & {
        service: { id: string; name: string }[] | { id: string; name: string } | null
      }
      return ((data ?? []) as Row[]).map((r) => ({
        ...r,
        service: Array.isArray(r.service) ? (r.service[0] ?? null) : r.service,
      }))
    },
    enabled: !!materialId,
    staleTime: 60_000,
  })
}

// =============================================================================
// Mutations
// =============================================================================

export function useCreateInventoryItem(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      unit?: string
      sku?: string | null
      category?: string | null
      current_stock?: number
      min_stock?: number
      cost_per_unit_cents?: number
      supplier?: string | null
      notes?: string | null
    }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('inventory_items')
        .insert({
          salon_id: salonId,
          name: input.name.trim(),
          unit: input.unit?.trim() || 'шт',
          sku: input.sku?.trim() || null,
          category: input.category?.trim() || null,
          current_stock: input.current_stock ?? 0,
          min_stock: input.min_stock ?? 0,
          cost_per_unit_cents: input.cost_per_unit_cents ?? 0,
          supplier: input.supplier?.trim() || null,
          notes: input.notes?.trim() || null,
        })
        .select(ITEM_FIELDS)
        .single()
      if (error) throw error
      return data as InventoryItemRow
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items', salonId] }),
  })
}

export function useUpdateInventoryItem(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      unit?: string
      sku?: string | null
      category?: string | null
      min_stock?: number
      cost_per_unit_cents?: number
      supplier?: string | null
      notes?: string | null
      is_archived?: boolean
    }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('inventory_items').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['inventory-items', salonId] })
      qc.invalidateQueries({ queryKey: ['inventory-items', 'one', vars.id] })
    },
  })
}

/** purchase / manual_adjustment / waste — через RPC с атомарным апдейтом stock. */
export function useApplyInventoryTx(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      material_id: string
      type: 'purchase' | 'manual_adjustment' | 'waste'
      quantity: number
      cost_cents?: number | null
      notes?: string | null
    }) => {
      const { data, error } = await supabase.rpc('inventory_apply_tx', {
        p_material_id: input.material_id,
        p_type: input.type,
        p_quantity: input.quantity,
        p_cost_cents: input.cost_cents ?? null,
        p_notes: input.notes ?? null,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['inventory-items', salonId] })
      qc.invalidateQueries({ queryKey: ['inventory-items', 'one', vars.material_id] })
      qc.invalidateQueries({ queryKey: ['inventory-tx', vars.material_id] })
    },
  })
}

export function useStocktake(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { material_id: string; actual_stock: number; notes?: string }) => {
      const { data, error } = await supabase.rpc('inventory_stocktake', {
        p_material_id: input.material_id,
        p_actual_stock: input.actual_stock,
        p_notes: input.notes ?? null,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['inventory-items', salonId] })
      qc.invalidateQueries({ queryKey: ['inventory-items', 'one', vars.material_id] })
      qc.invalidateQueries({ queryKey: ['inventory-tx', vars.material_id] })
    },
  })
}

export function useUpsertServiceMaterial(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { service_id: string; material_id: string; quantity: number }) => {
      const { error } = await supabase.from('service_materials').upsert(
        {
          service_id: input.service_id,
          material_id: input.material_id,
          quantity: input.quantity,
        },
        { onConflict: 'service_id,material_id' },
      )
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['service-recipe', vars.service_id] })
      qc.invalidateQueries({ queryKey: ['material-usage', vars.material_id] })
      qc.invalidateQueries({ queryKey: ['inventory-items', salonId] })
    },
  })
}

// =============================================================================
// Analytics
// =============================================================================

export type PlanVsFactRow = {
  material_id: string
  material_name: string
  unit: string
  planned: number
  actual: number
  variance: number
  variance_value_cents: number
  cost_per_unit_cents: number
}

export function useInventoryPlanVsFact(
  salonId: string | undefined,
  period: { start: string; end: string },
) {
  return useQuery<PlanVsFactRow[]>({
    queryKey: ['inv-plan-vs-fact', salonId, period],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('inventory_plan_vs_fact', {
        p_salon_id: salonId,
        p_period_start: period.start,
        p_period_end: period.end,
      })
      if (error) throw error
      return (data ?? []) as PlanVsFactRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export type StaffConsumptionRow = {
  staff_id: string
  staff_full_name: string
  material_id: string
  material_name: string
  unit: string
  total_consumed: number
  visit_count: number
  avg_per_visit: number
  expected_per_visit: number | null
  cost_per_unit_cents: number
  total_cost_cents: number
}

export function useStaffMaterialConsumption(
  salonId: string | undefined,
  period: { start: string; end: string },
) {
  return useQuery<StaffConsumptionRow[]>({
    queryKey: ['inv-by-staff', salonId, period],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('inventory_consumption_by_staff', {
        p_salon_id: salonId,
        p_period_start: period.start,
        p_period_end: period.end,
      })
      if (error) throw error
      return (data ?? []) as StaffConsumptionRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

// =============================================================================
// Bulk CSV import + categories management
// =============================================================================

export type CsvImportRow = {
  name: string
  unit?: string
  category?: string
  current_stock?: number
  min_stock?: number
  cost_per_unit_cents?: number
  sku?: string
  supplier?: string
}

export function useBulkImportInventory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rows: CsvImportRow[]) => {
      if (!salonId) throw new Error('no_salon')
      if (rows.length === 0) return { inserted: 0 }
      const payload = rows.map((r) => ({
        salon_id: salonId,
        name: r.name.trim(),
        unit: (r.unit ?? 'шт').trim() || 'шт',
        category: r.category?.trim() || null,
        current_stock: r.current_stock ?? 0,
        min_stock: r.min_stock ?? 0,
        cost_per_unit_cents: r.cost_per_unit_cents ?? 0,
        sku: r.sku?.trim() || null,
        supplier: r.supplier?.trim() || null,
      }))
      const { data, error } = await supabase.from('inventory_items').insert(payload).select('id')
      if (error) throw error
      return { inserted: data?.length ?? 0 }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items', salonId] }),
  })
}

export function useRenameCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { from: string; to: string | null }) => {
      if (!salonId) throw new Error('no_salon')
      // Перевешиваем категорию на items
      const { error } = await supabase
        .from('inventory_items')
        .update({ category: input.to?.trim() || null })
        .eq('salon_id', salonId)
        .eq('category', input.from)
      if (error) throw error
      // Синхронизируем salons.inventory_categories: убираем from, добавляем to
      const { data: salon, error: e1 } = await supabase
        .from('salons')
        .select('inventory_categories')
        .eq('id', salonId)
        .single()
      if (e1) throw e1
      const current = (salon?.inventory_categories ?? []) as string[]
      const next = current.filter((c) => c !== input.from)
      if (input.to && !next.includes(input.to)) next.push(input.to)
      const { error: e2 } = await supabase
        .from('salons')
        .update({ inventory_categories: next })
        .eq('id', salonId)
      if (e2) throw e2
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-items', salonId] })
      qc.invalidateQueries({ queryKey: ['inventory-categories', salonId] })
      qc.invalidateQueries({ queryKey: ['salon', salonId] })
    },
  })
}

/**
 * Union: salons.inventory_categories ∪ DISTINCT items.category.
 * Возвращает отсортированный список категорий для dropdown'а в форме материала
 * и в Categories Dialog.
 */
export function useInventoryCategories(salonId: string | undefined) {
  return useQuery<string[]>({
    queryKey: ['inventory-categories', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const [salonRes, itemsRes] = await Promise.all([
        supabase.from('salons').select('inventory_categories').eq('id', salonId).single(),
        supabase
          .from('inventory_items')
          .select('category')
          .eq('salon_id', salonId)
          .not('category', 'is', null),
      ])
      if (salonRes.error) throw salonRes.error
      if (itemsRes.error) throw itemsRes.error
      const stored = (salonRes.data?.inventory_categories ?? []) as string[]
      const fromItems = (itemsRes.data ?? [])
        .map((r) => r.category as string | null)
        .filter((c): c is string => !!c)
      const set = new Set([...stored, ...fromItems])
      return Array.from(set).sort((a, b) => a.localeCompare(b))
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useAddInventoryCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      if (!salonId) throw new Error('no_salon')
      const trimmed = name.trim()
      if (!trimmed) throw new Error('empty')
      const { data: salon, error: e1 } = await supabase
        .from('salons')
        .select('inventory_categories')
        .eq('id', salonId)
        .single()
      if (e1) throw e1
      const current = (salon?.inventory_categories ?? []) as string[]
      if (current.includes(trimmed)) return trimmed
      const next = [...current, trimmed]
      const { error: e2 } = await supabase
        .from('salons')
        .update({ inventory_categories: next })
        .eq('id', salonId)
      if (e2) throw e2
      return trimmed
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-categories', salonId] })
      qc.invalidateQueries({ queryKey: ['salon', salonId] })
    },
  })
}

export function useDeleteServiceMaterial(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { service_id: string; material_id: string }) => {
      const { error } = await supabase
        .from('service_materials')
        .delete()
        .eq('service_id', input.service_id)
        .eq('material_id', input.material_id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['service-recipe', vars.service_id] })
      qc.invalidateQueries({ queryKey: ['material-usage', vars.material_id] })
      qc.invalidateQueries({ queryKey: ['inventory-items', salonId] })
    },
  })
}
