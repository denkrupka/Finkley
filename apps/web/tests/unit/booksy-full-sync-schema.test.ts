/**
 * Тесты ADR-017 (Booksy full sync):
 *   - clients.discount_percent — constraint 0..100
 *   - salons.working_hours — jsonb default 7 дней
 *   - salon_integrations.config — jsonb default '{}'
 *   - salon_integrations.last_clients_sync_at / last_catalog_sync_at — nullable
 *   - visits.external_reservation_id — nullable text
 *   - visits anti-dup: UNIQUE (salon_id, source, external_id) с onConflict
 *     ignoreDuplicates не плодит вторую запись
 *
 * Тесты пропускаются если миграция 20260520000001 ещё не применена на тестовой
 * БД — пробуем INSERT с новой колонкой и если PGRST204 (no column in schema
 * cache), весь describe скипается. Это разовый случай между моментом написания
 * миграции и её деплоем; после deploy все тесты будут зелёные.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, makeClient, SUPABASE_SERVICE, type Ctx } from './_helpers'

// Один раз проверяем доступность новых колонок. Если их нет — describe скипается.
async function migrationApplied(): Promise<boolean> {
  if (shouldSkip) return false
  const admin = makeClient(SUPABASE_SERVICE, 'booksy017-probe')
  // Пытаемся SELECT новой колонки. PGRST204 → колонки нет.
  const { error } = await admin.from('clients').select('discount_percent').limit(1)
  return !error
}

const migrationOk = await migrationApplied()
const skipReason = !migrationOk ? 'migration 20260520000001 not yet applied to test DB' : null
if (skipReason) {
   
  console.warn(`[booksy-full-sync-schema] skipped: ${skipReason}`)
}

describe.skipIf(shouldSkip || !migrationOk)(
  'ADR-017 schema: clients/salons/integrations/visits',
  () => {
    let ctx: Ctx | null = null

    beforeAll(async () => {
      ctx = await bootstrap('booksy017')
    }, 30_000)
    afterAll(async () => teardown(ctx))

    it('clients.discount_percent принимает 0..100 и отклоняет -1 / 101', async () => {
      if (!ctx) throw new Error('no ctx')

      // 50% — OK
      const { data: c1, error: e1 } = await ctx.admin
        .from('clients')
        .insert({ salon_id: ctx.salonId, name: 'C1', discount_percent: 50 })
        .select('id, discount_percent')
        .single()
      expect(e1).toBeNull()
      expect(Number(c1!.discount_percent)).toBe(50)

      // 0% — OK
      const { error: e2 } = await ctx.admin
        .from('clients')
        .insert({ salon_id: ctx.salonId, name: 'C2', discount_percent: 0 })
      expect(e2).toBeNull()

      // 100% — OK (граничное)
      const { error: e3 } = await ctx.admin
        .from('clients')
        .insert({ salon_id: ctx.salonId, name: 'C3', discount_percent: 100 })
      expect(e3).toBeNull()

      // 101% — отклонено
      const { error: e4 } = await ctx.admin
        .from('clients')
        .insert({ salon_id: ctx.salonId, name: 'C4', discount_percent: 101 })
      expect(e4).not.toBeNull()

      // -1% — отклонено
      const { error: e5 } = await ctx.admin
        .from('clients')
        .insert({ salon_id: ctx.salonId, name: 'C5', discount_percent: -1 })
      expect(e5).not.toBeNull()
    })

    it('salons.opening_hours_external_snapshot — nullable snapshot для Booksy sync', async () => {
      if (!ctx) throw new Error('no ctx')
      const { data: salon, error } = await ctx.admin
        .from('salons')
        .select('opening_hours, opening_hours_external_snapshot')
        .eq('id', ctx.salonId)
        .single()
      expect(error).toBeNull()
      // Default opening_hours существует (миграция 20260515000011)
      expect(salon!.opening_hours).toBeTruthy()
      // Snapshot пока null — заполнится при первом Booksy sync
      expect(salon!.opening_hours_external_snapshot).toBeNull()
    })

    it('salon_integrations.config default empty + tier timestamps nullable', async () => {
      if (!ctx) throw new Error('no ctx')

      const { data: integ, error } = await ctx.admin
        .from('salon_integrations')
        .insert({
          salon_id: ctx.salonId,
          provider: 'booksy',
          status: 'connected',
          credentials: { access_token: 'tok', business_id: 1 },
        })
        .select('config, last_clients_sync_at, last_catalog_sync_at')
        .single()
      expect(error).toBeNull()
      expect(integ!.config).toEqual({})
      expect(integ!.last_clients_sync_at).toBeNull()
      expect(integ!.last_catalog_sync_at).toBeNull()

      // Можно записать флаги через update
      const { error: e2 } = await ctx.admin
        .from('salon_integrations')
        .update({
          config: { booksy_owns_payment_status: false, booksy_can_delete_visits: true },
          last_clients_sync_at: new Date().toISOString(),
          last_catalog_sync_at: new Date().toISOString(),
        })
        .eq('salon_id', ctx.salonId)
        .eq('provider', 'booksy')
      expect(e2).toBeNull()
    })

    it('visits anti-dup: повторный upsert с тем же (source, external_id) не плодит дубль', async () => {
      if (!ctx) throw new Error('no ctx')

      const externalId = 'subbk:99999'
      const visitAt = new Date().toISOString()

      // Первый INSERT
      const { error: e1 } = await ctx.admin.from('visits').upsert(
        {
          salon_id: ctx.salonId,
          visit_at: visitAt,
          amount_cents: 10000,
          payment_method: 'cash',
          status: 'pending',
          source: 'booksy',
          external_id: externalId,
        },
        { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
      )
      expect(e1).toBeNull()

      // Повторный upsert с тем же external_id — не плодит row
      const { error: e2 } = await ctx.admin.from('visits').upsert(
        {
          salon_id: ctx.salonId,
          visit_at: visitAt,
          amount_cents: 99999, // другая сумма — должна быть проигнорирована (ignoreDuplicates)
          payment_method: 'card',
          status: 'paid',
          source: 'booksy',
          external_id: externalId,
        },
        { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
      )
      expect(e2).toBeNull()

      // Проверяем что row один и amount_cents не перезаписан
      const { data: rows } = await ctx.admin
        .from('visits')
        .select('id, amount_cents, status')
        .eq('salon_id', ctx.salonId)
        .eq('source', 'booksy')
        .eq('external_id', externalId)
      expect(rows).toHaveLength(1)
      // amount остался первоначальный (10000), не перезаписан вторым upsert'ом
      expect(rows![0]!.amount_cents).toBe(10000)
      expect(rows![0]!.status).toBe('pending')
    })

    it('visits.external_reservation_id записывается и читается', async () => {
      if (!ctx) throw new Error('no ctx')

      const { data: visit, error } = await ctx.admin
        .from('visits')
        .insert({
          salon_id: ctx.salonId,
          visit_at: new Date().toISOString(),
          amount_cents: 5000,
          payment_method: 'cash',
          status: 'pending',
          source: 'manual',
          external_reservation_id: '625115071',
        })
        .select('id, external_reservation_id')
        .single()
      expect(error).toBeNull()
      expect(visit!.external_reservation_id).toBe('625115071')
    })

    it('portal-owned: ручная правка amount/status не перезаписывается при повторном upsert', async () => {
      if (!ctx) throw new Error('no ctx')

      const externalId = 'subbk:portal-owned-test'
      const visitAt = new Date().toISOString()

      // 1) Booksy создаёт визит со status=pending, amount=5000
      await ctx.admin.from('visits').upsert(
        {
          salon_id: ctx.salonId,
          visit_at: visitAt,
          amount_cents: 5000,
          payment_method: 'cash',
          status: 'pending',
          source: 'booksy',
          external_id: externalId,
        },
        { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
      )

      // 2) Юзер вручную правит в портале: amount=7500, status=paid
      const { data: row1 } = await ctx.admin
        .from('visits')
        .select('id')
        .eq('salon_id', ctx.salonId)
        .eq('source', 'booksy')
        .eq('external_id', externalId)
        .single()
      await ctx.admin
        .from('visits')
        .update({ amount_cents: 7500, status: 'paid', payment_method: 'card' })
        .eq('id', row1!.id)

      // 3) Booksy sync приходит снова с другими данными — НЕ должен перезаписать
      await ctx.admin.from('visits').upsert(
        {
          salon_id: ctx.salonId,
          visit_at: visitAt,
          amount_cents: 99999,
          payment_method: 'cash',
          status: 'pending',
          source: 'booksy',
          external_id: externalId,
        },
        { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
      )

      // 4) Проверка: ручные правки сохранились
      const { data: final } = await ctx.admin
        .from('visits')
        .select('amount_cents, status, payment_method')
        .eq('id', row1!.id)
        .single()
      expect(final!.amount_cents).toBe(7500)
      expect(final!.status).toBe('paid')
      expect(final!.payment_method).toBe('card')
    })

    it('anti-overlap: два разных subbookings одного appointment_uid с разными external_id — обе записи живут', async () => {
      if (!ctx) throw new Error('no ctx')

      const visitAt1 = new Date('2026-05-01T10:00:00Z').toISOString()
      const visitAt2 = new Date('2026-05-01T10:30:00Z').toISOString()

      // Два subbookings одного appointment (multi-service запись в Booksy)
      await ctx.admin.from('visits').upsert(
        [
          {
            salon_id: ctx.salonId,
            visit_at: visitAt1,
            amount_cents: 4000,
            payment_method: 'cash',
            status: 'pending',
            source: 'booksy',
            external_id: 'subbk:1001',
            group_key: 'booksy:appt:5000',
          },
          {
            salon_id: ctx.salonId,
            visit_at: visitAt2,
            amount_cents: 6000,
            payment_method: 'cash',
            status: 'pending',
            source: 'booksy',
            external_id: 'subbk:1002',
            group_key: 'booksy:appt:5000',
          },
        ],
        { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
      )

      const { data: rows } = await ctx.admin
        .from('visits')
        .select('id, external_id, amount_cents')
        .eq('salon_id', ctx.salonId)
        .eq('group_key', 'booksy:appt:5000')
      expect(rows).toHaveLength(2)
      // Каждый subbk создал свою row, не «наложились»
      expect(new Set(rows!.map((r) => r.external_id))).toEqual(
        new Set(['subbk:1001', 'subbk:1002']),
      )
    })

    it('staff: email + invite_sent_at + external_snapshot новые поля доступны', async () => {
      if (!ctx) throw new Error('no ctx')
      const { data: staff, error } = await ctx.admin
        .from('staff')
        .insert({
          salon_id: ctx.salonId,
          full_name: 'Test Master',
          email: 'master@example.com',
          external_source: 'booksy',
          external_id: '123',
          external_snapshot: { name: 'Test Master', email: 'master@example.com' },
        })
        .select('id, email, invite_sent_at, external_snapshot')
        .single()
      expect(error).toBeNull()
      expect(staff!.email).toBe('master@example.com')
      expect(staff!.invite_sent_at).toBeNull()
      expect(staff!.external_snapshot).toEqual({
        name: 'Test Master',
        email: 'master@example.com',
      })
    })
  },
)
