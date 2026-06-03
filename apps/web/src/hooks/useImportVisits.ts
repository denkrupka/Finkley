import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { ClientRow } from '@/hooks/useClients'
import type { ServiceRow } from '@/hooks/useServices'
import type { StaffRow } from '@/hooks/useStaff'
import { supabase } from '@/lib/supabase/client'
import { hashRow, parseAmountLoose, parseDateLoose } from '@/lib/utils/csv'
import { normalizeSearchPhone, toE164 } from '@/lib/utils/format-phone'

import type { PaymentMethod } from './useVisits'

export type ImportColumnMapping = Record<
  number,
  | 'skip'
  | 'visit_at'
  | 'amount'
  | 'client_name'
  | 'client_phone'
  | 'service_name'
  | 'staff_name'
  | 'payment_method'
  | 'comment'
>

export type ImportProgress = {
  done: number
  total: number
  inserted: number
  skipped: number
  failed: number
  errors: { row: number; message: string }[]
}

const VALID_PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'transfer', 'online', 'mixed']

function normalizePaymentMethod(raw: string): PaymentMethod {
  const v = raw.toLowerCase().trim()
  if (!v) return 'cash'
  if (/cash|нал|готов/i.test(v)) return 'cash'
  if (/card|карт|kart/i.test(v)) return 'card'
  if (/transfer|перевод|przelew/i.test(v)) return 'transfer'
  if (/online|blik|onl/i.test(v)) return 'online'
  if (/mixed|смеш|разн/i.test(v)) return 'mixed'
  return (VALID_PAYMENT_METHODS.includes(v as PaymentMethod) ? v : 'cash') as PaymentMethod
}

type ImportInput = {
  rows: string[][]
  mapping: ImportColumnMapping
  clients: ClientRow[]
  staff: StaffRow[]
  services: ServiceRow[]
  onProgress?: (p: ImportProgress) => void
}

type ImportResult = {
  inserted: number
  skipped: number
  failed: number
  errors: { row: number; message: string }[]
}

export function useImportVisits(salonId: string | undefined) {
  const qc = useQueryClient()

  return useMutation<ImportResult, Error, ImportInput>({
    mutationFn: async (input) => {
      if (!salonId) throw new Error('no salon')

      const { rows, mapping, clients, staff, services, onProgress } = input
      const total = rows.length
      const progress: ImportProgress = {
        done: 0,
        total,
        inserted: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      }

      // Индексы для быстрого lookup
      const clientByPhone = new Map<string, ClientRow>()
      const clientByName = new Map<string, ClientRow>()
      for (const c of clients) {
        if (c.phone) clientByPhone.set(normalizeSearchPhone(c.phone), c)
        clientByName.set(c.name.toLowerCase().trim(), c)
      }
      const staffByName = new Map<string, StaffRow>()
      for (const s of staff) staffByName.set(s.full_name.toLowerCase().trim(), s)
      const serviceByName = new Map<string, ServiceRow>()
      for (const s of services) serviceByName.set(s.name.toLowerCase().trim(), s)

      // Раскладываем mapping на удобный вид
      const colByField: Partial<Record<ImportColumnMapping[number], number>> = {}
      for (const [col, field] of Object.entries(mapping)) {
        if (field !== 'skip') colByField[field] = Number(col)
      }

      const dateCol = colByField.visit_at
      const amountCol = colByField.amount
      if (dateCol == null || amountCol == null) {
        throw new Error('mapping_missing_required')
      }

      const inserts: {
        rowIndex: number
        salon_id: string
        staff_id: string | null
        client_id: string | null
        service_id: string | null
        service_name_snapshot: string | null
        visit_at: string
        amount_cents: number
        payment_method: PaymentMethod
        comment: string | null
        source: string
        external_id: string
      }[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!
        const get = (col: number | undefined) => (col == null ? '' : (row[col] ?? '').trim())

        const rawDate = get(dateCol)
        const rawAmount = get(amountCol)
        const rawClientName = get(colByField.client_name)
        const rawClientPhone = get(colByField.client_phone)
        const rawServiceName = get(colByField.service_name)
        const rawStaffName = get(colByField.staff_name)
        const rawPayment = get(colByField.payment_method)
        const rawComment = get(colByField.comment)

        const date = parseDateLoose(rawDate)
        const amount = parseAmountLoose(rawAmount)

        if (!date) {
          progress.failed++
          progress.errors.push({ row: i + 2, message: `bad_date: "${rawDate}"` })
          progress.done++
          onProgress?.({ ...progress, errors: [...progress.errors] })
          continue
        }
        if (amount == null || amount < 0) {
          progress.failed++
          progress.errors.push({ row: i + 2, message: `bad_amount: "${rawAmount}"` })
          progress.done++
          onProgress?.({ ...progress, errors: [...progress.errors] })
          continue
        }

        // Lookup или создание клиента
        let clientId: string | null = null
        if (rawClientPhone || rawClientName) {
          const phoneKey = rawClientPhone ? normalizeSearchPhone(rawClientPhone) : ''
          const nameKey = rawClientName.toLowerCase().trim()
          let existing: ClientRow | undefined
          if (phoneKey && clientByPhone.has(phoneKey)) existing = clientByPhone.get(phoneKey)
          else if (nameKey && clientByName.has(nameKey)) existing = clientByName.get(nameKey)

          if (existing) {
            clientId = existing.id
          } else if (rawClientName) {
            const phoneE164 = rawClientPhone ? toE164(rawClientPhone) : null
            const { data: created, error } = await supabase
              .from('clients')
              .insert({
                salon_id: salonId,
                name: rawClientName,
                phone: phoneE164 ?? rawClientPhone ?? null,
              })
              .select('*')
              .single()
            if (error) {
              progress.failed++
              progress.errors.push({ row: i + 2, message: `client_create: ${error.message}` })
              progress.done++
              onProgress?.({ ...progress, errors: [...progress.errors] })
              continue
            }
            const newClient = created as ClientRow
            clientId = newClient.id
            clientByName.set(nameKey, newClient)
            if (phoneKey) clientByPhone.set(phoneKey, newClient)
          }
        }

        // Bug 71f46bd8/28d09ce9 (Елена 02.06): авто-создаём мастера и услуги
        // если их нет в системе. Юзер сказал "ни один мастер не подтянулся"
        // потому что имена в CSV отличались от заведённых. Теперь мастера/
        // услуги создаются на лету и привязываются к визитам.
        let staffMatch: StaffRow | null = null
        if (rawStaffName) {
          const key = rawStaffName.toLowerCase().trim()
          staffMatch = staffByName.get(key) ?? null
          if (!staffMatch) {
            const { data: created, error: cErr } = await supabase
              .from('staff')
              .insert({ salon_id: salonId, full_name: rawStaffName, is_active: true })
              .select('*')
              .single()
            if (!cErr && created) {
              staffMatch = created as StaffRow
              staffByName.set(key, staffMatch)
            }
          }
        }
        let serviceMatch: ServiceRow | null = null
        if (rawServiceName) {
          const key = rawServiceName.toLowerCase().trim()
          serviceMatch = serviceByName.get(key) ?? null
          if (!serviceMatch) {
            const { data: created, error: sErr } = await supabase
              .from('services')
              .insert({
                salon_id: salonId,
                name: rawServiceName,
                price_cents: Math.round(amount * 100),
                duration_min: 60,
                is_active: true,
              })
              .select('*')
              .single()
            if (!sErr && created) {
              serviceMatch = created as ServiceRow
              serviceByName.set(key, serviceMatch)
            }
          }
        }

        const amountCents = Math.round(amount * 100)
        const externalId = await hashRow([
          salonId,
          date.toISOString(),
          amountCents,
          rawClientName,
          rawServiceName,
          rawStaffName,
        ])

        inserts.push({
          rowIndex: i + 2,
          salon_id: salonId,
          staff_id: staffMatch?.id ?? null,
          client_id: clientId,
          service_id: serviceMatch?.id ?? null,
          service_name_snapshot: rawServiceName || null,
          visit_at: date.toISOString(),
          amount_cents: amountCents,
          payment_method: rawPayment ? normalizePaymentMethod(rawPayment) : 'cash',
          comment: rawComment || null,
          source: 'csv_import',
          external_id: externalId,
        })

        progress.done++
        onProgress?.({ ...progress, errors: [...progress.errors] })
      }

      // Batch-insert по 50 строк (Supabase ограничивает payload, 50 — безопасно)
      const CHUNK = 50
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const chunk = inserts.slice(i, i + CHUNK)
        const payload = chunk.map(({ rowIndex: _ignore, ...rest }) => rest)
        const { error } = await supabase.from('visits').insert(payload)
        if (!error) {
          progress.inserted += chunk.length
        } else if (
          error.code === '23505' || // unique_violation — дубль по (salon, source, external_id)
          /duplicate key/i.test(error.message)
        ) {
          // Если упал весь batch — fallback: пробуем по одному
          for (const single of chunk) {
            const { rowIndex: _i, ...singleRest } = single
            const { error: e2 } = await supabase.from('visits').insert(singleRest)
            if (!e2) {
              progress.inserted++
            } else if (e2.code === '23505' || /duplicate key/i.test(e2.message)) {
              progress.skipped++
            } else {
              progress.failed++
              progress.errors.push({ row: single.rowIndex, message: e2.message })
            }
          }
        } else {
          progress.failed += chunk.length
          for (const c of chunk) {
            progress.errors.push({ row: c.rowIndex, message: error.message })
          }
        }
        onProgress?.({ ...progress, errors: [...progress.errors] })
      }

      return {
        inserted: progress.inserted,
        skipped: progress.skipped,
        failed: progress.failed,
        errors: progress.errors,
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
      qc.invalidateQueries({ queryKey: ['clients', salonId] })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
    },
  })
}
