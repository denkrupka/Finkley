import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type OpeningHours = Record<DayKey, { open?: string; close?: string; closed?: boolean }>

export const DEFAULT_OPENING_HOURS: OpeningHours = {
  mon: { open: '09:00', close: '20:00', closed: false },
  tue: { open: '09:00', close: '20:00', closed: false },
  wed: { open: '09:00', close: '20:00', closed: false },
  thu: { open: '09:00', close: '20:00', closed: false },
  fri: { open: '09:00', close: '20:00', closed: false },
  sat: { open: '10:00', close: '18:00', closed: false },
  sun: { closed: true },
}

export const DAY_KEYS_ORDERED: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** JS Date.getDay() — 0=Sun..6=Sat. Возвращаем наш DayKey. */
export function dayKeyForDate(d: Date): DayKey {
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[d.getDay()] ?? 'mon'
}

export type SalonHoliday = {
  id: string
  salon_id: string
  date: string
  label: string
  is_recurring: boolean
  country_code: string | null
  created_at: string
}

export function useSalonHolidays(salonId: string | undefined) {
  return useQuery<SalonHoliday[]>({
    queryKey: ['salon-holidays', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_holidays')
        .select('*')
        .eq('salon_id', salonId)
        .order('date', { ascending: true })
      if (error) throw error
      return (data ?? []) as SalonHoliday[]
    },
    enabled: !!salonId,
  })
}

export function useAddHolidays(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      rows: Array<{ date: string; label: string; country_code?: string | null }>,
    ) => {
      if (!salonId || rows.length === 0) return
      const payload = rows.map((r) => ({
        salon_id: salonId,
        date: r.date,
        label: r.label,
        country_code: r.country_code ?? null,
      }))
      // upsert по (salon_id, date) — если уже есть, обновляем label
      const { error } = await supabase
        .from('salon_holidays')
        .upsert(payload, { onConflict: 'salon_id,date' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-holidays', salonId] })
    },
  })
}

export function useDeleteHoliday(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('salon_holidays').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-holidays', salonId] })
    },
  })
}

export function useDeleteHolidaysByCountry(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (countryCode: string) => {
      if (!salonId) return
      const { error } = await supabase
        .from('salon_holidays')
        .delete()
        .eq('salon_id', salonId)
        .eq('country_code', countryCode)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-holidays', salonId] })
    },
  })
}

/**
 * Возвращает рабочие границы (минуты от полуночи) для конкретной даты.
 * Учитывает opening_hours дня недели и holidays. null = закрыто.
 */
export function getOpeningRangeForDate(
  date: Date,
  hours: OpeningHours,
  holidayDatesIso: Set<string>,
): { startMin: number; endMin: number } | null {
  const iso =
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  if (holidayDatesIso.has(iso)) return null
  const day = dayKeyForDate(date)
  const cfg = hours[day]
  if (!cfg || cfg.closed || !cfg.open || !cfg.close) return null
  return { startMin: parseHHMM(cfg.open), endMin: parseHHMM(cfg.close) }
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
