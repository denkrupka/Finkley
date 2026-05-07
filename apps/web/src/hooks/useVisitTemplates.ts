import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type VisitTemplateRow = {
  id: string
  client_id: string
  staff_id: string | null
  service_id: string | null
  recurrence_days: number
  amount_cents: number | null
  next_due_at: string
  paused_at: string | null
  created_at: string
}

export type UpcomingTemplateRow = {
  id: string
  client_id: string
  client_name: string
  staff_id: string | null
  staff_name: string | null
  service_id: string | null
  service_name: string | null
  recurrence_days: number
  next_due_at: string
  days_until: number
}

/** Шаблоны конкретного клиента (для drawer). */
export function useClientTemplates(clientId: string | undefined) {
  return useQuery<VisitTemplateRow[]>({
    queryKey: ['visit-templates', 'client', clientId],
    queryFn: async () => {
      if (!clientId) return []
      const { data, error } = await supabase
        .from('visit_templates')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as VisitTemplateRow[]
    },
    enabled: !!clientId,
    staleTime: 60_000,
  })
}

/** Ближайшие due-шаблоны для виджета на дашборде. */
export function useUpcomingTemplates(salonId: string | undefined, horizonDays = 7) {
  return useQuery<UpcomingTemplateRow[]>({
    queryKey: ['visit-templates', 'upcoming', salonId, horizonDays],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('upcoming_visit_templates', {
        p_salon_id: salonId,
        p_horizon_days: horizonDays,
      })
      if (error) throw error
      return ((data ?? []) as UpcomingTemplateRow[]).map((r) => ({
        ...r,
        days_until: Number(r.days_until),
        recurrence_days: Number(r.recurrence_days),
      }))
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useCreateVisitTemplate(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      client_id: string
      staff_id: string | null
      service_id: string | null
      recurrence_days: number
      amount_cents: number | null
      next_due_at: string
    }) => {
      if (!salonId) throw new Error('no salon')
      const { error } = await supabase
        .from('visit_templates')
        .insert({ salon_id: salonId, ...input })
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['visit-templates', 'client', vars.client_id] })
      qc.invalidateQueries({ queryKey: ['visit-templates', 'upcoming', salonId] })
    },
  })
}

export function useDeleteVisitTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase.from('visit_templates').delete().eq('id', templateId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-templates'] })
    },
  })
}

export function useToggleTemplatePause() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; paused: boolean }) => {
      const { error } = await supabase
        .from('visit_templates')
        .update({ paused_at: input.paused ? new Date().toISOString() : null })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-templates'] })
    },
  })
}

/** После того как визит реально создан → сдвигаем next_due_at на recurrence_days вперёд. */
export function useAdvanceTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; days: number }) => {
      const next = new Date()
      next.setDate(next.getDate() + input.days)
      const { error } = await supabase
        .from('visit_templates')
        .update({ next_due_at: next.toISOString().slice(0, 10) })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-templates'] })
    },
  })
}
