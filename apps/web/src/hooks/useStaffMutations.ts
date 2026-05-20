import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

import type { StaffPayoutScheme, WeeklySchedule } from './useStaff'

/**
 * Поля, которые поддерживает UI-форма мастера. Бэкенд хранит все поля схемы
 * на одной строке staff; в UI большинство полей опциональны и используются
 * в зависимости от выбранной payout_scheme.
 */
export type StaffWriteInput = {
  full_name: string
  payout_scheme: StaffPayoutScheme
  payout_percent?: number | null
  payout_fixed_cents?: number | null
  chair_rent_cents?: number | null
  weekly_schedule?: WeeklySchedule
  retail_payout_enabled?: boolean
  retail_payout_percent?: number | null
  retention_window_days?: number | null
}

/**
 * Нормализует входные данные под выбранную схему: лишние поля обнуляем,
 * чтобы не путали при чтении и не ломали будущий расчёт payouts.
 */
function normalize(input: StaffWriteInput) {
  const base: Record<string, unknown> = {
    full_name: input.full_name.trim(),
    payout_scheme: input.payout_scheme,
    payout_percent: null,
    payout_fixed_cents: null,
    chair_rent_cents: null,
  }
  switch (input.payout_scheme) {
    case 'fixed':
      base.payout_fixed_cents = input.payout_fixed_cents ?? 0
      break
    case 'percent_revenue':
      base.payout_percent = input.payout_percent ?? 0
      break
    case 'percent_service':
      break
    case 'chair_rent':
      base.chair_rent_cents = input.chair_rent_cents ?? 0
      break
    case 'mixed':
      base.payout_fixed_cents = input.payout_fixed_cents ?? 0
      base.payout_percent = input.payout_percent ?? 0
      break
  }
  // Опциональные поля передаём только если заданы — иначе оставляем дефолты в БД.
  if (input.weekly_schedule !== undefined) base.weekly_schedule = input.weekly_schedule
  if (input.retail_payout_enabled !== undefined)
    base.retail_payout_enabled = input.retail_payout_enabled
  if (input.retail_payout_percent !== undefined)
    base.retail_payout_percent = input.retail_payout_percent
  if (input.retention_window_days !== undefined)
    base.retention_window_days = input.retention_window_days
  return base
}

export function useCreateStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: StaffWriteInput) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase
        .from('staff')
        .insert({ salon_id: salonId, ...normalize(input) })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}

export function useUpdateStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string } & StaffWriteInput) => {
      const { id, ...rest } = input
      const { error } = await supabase.from('staff').update(normalize(rest)).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}

export function useArchiveStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (staffId: string) => {
      // Не удаляем — сохраняем историю визитов. is_active=false скрывает мастера в селектах.
      const { error } = await supabase.from('staff').update({ is_active: false }).eq('id', staffId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}

export function useUnarchiveStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (staffId: string) => {
      const { error } = await supabase.from('staff').update({ is_active: true }).eq('id', staffId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}

/**
 * Переключает видимость мастера в календаре (не влияет на is_active).
 * Используется в Popover по клику на staff cell в VisitsCalendarView.
 */
export function useToggleStaffCalendarVisibility(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; visible: boolean }) => {
      const { error } = await supabase
        .from('staff')
        .update({ visible_on_calendar: input.visible })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}
