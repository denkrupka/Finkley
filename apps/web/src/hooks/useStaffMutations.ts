import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

import type { StaffPayoutScheme } from './useStaff'

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
}

/**
 * Нормализует входные данные под выбранную схему: лишние поля обнуляем,
 * чтобы не путали при чтении и не ломали будущий расчёт payouts.
 */
function normalize(input: StaffWriteInput) {
  const base = {
    full_name: input.full_name.trim(),
    payout_scheme: input.payout_scheme,
    payout_percent: null as number | null,
    payout_fixed_cents: null as number | null,
    chair_rent_cents: null as number | null,
  }
  switch (input.payout_scheme) {
    case 'fixed':
      base.payout_fixed_cents = input.payout_fixed_cents ?? 0
      break
    case 'percent_revenue':
      base.payout_percent = input.payout_percent ?? 0
      break
    case 'percent_service':
      // Базового % нет — задаётся per-service в staff_service_overrides.
      break
    case 'chair_rent':
      base.chair_rent_cents = input.chair_rent_cents ?? 0
      break
    case 'mixed':
      base.payout_fixed_cents = input.payout_fixed_cents ?? 0
      base.payout_percent = input.payout_percent ?? 0
      break
  }
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
