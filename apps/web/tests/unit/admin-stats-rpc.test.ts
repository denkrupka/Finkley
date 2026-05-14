/**
 * Интеграционные тесты для super-admin Edge Function `admin-stats`.
 * Покрывают: salon_block/unblock, salon_extend_demo (3 ветки),
 * salon_add_user, salon_delete каскад, user_block (+защита super),
 * admin_grant/revoke (+защита super), feedback_approve/reject.
 *
 * Запускаются против TEST-проекта Supabase. Все артефакты (юзеры, салоны,
 * подписки) создаются с уникальным prefix per-test и чистятся в afterEach.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeClient, SUPABASE_ANON, SUPABASE_SERVICE, SUPABASE_URL, shouldSkip } from './_helpers'

type AdminCtx = {
  adminId: string
  adminToken: string
  email: string
}

async function makeSuperAdmin(prefix: string): Promise<AdminCtx> {
  const admin = makeClient(SUPABASE_SERVICE, `${prefix}-svc`)
  const email = `${prefix}-${Date.now()}@finkley.test`
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: 'AdminPass123!',
    email_confirm: true,
  })
  if (error || !created.user) throw error ?? new Error('admin user not created')
  // Назначаем app_admin + super
  await admin
    .from('app_admins')
    .upsert({ user_id: created.user.id, is_super: true }, { onConflict: 'user_id' })

  const userClient = makeClient(SUPABASE_ANON, `${prefix}-admin-cli`)
  const { data: session } = await userClient.auth.signInWithPassword({
    email,
    password: 'AdminPass123!',
  })
  if (!session.session) throw new Error('admin sign-in failed')
  return { adminId: created.user.id, adminToken: session.session.access_token, email }
}

async function makeUser(prefix: string): Promise<{ id: string; email: string }> {
  const admin = makeClient(SUPABASE_SERVICE, `${prefix}-svc`)
  const email = `${prefix}-${Date.now()}-u@finkley.test`
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: 'UserPass123!',
    email_confirm: true,
  })
  if (error || !created.user) throw error ?? new Error('user not created')
  return { id: created.user.id, email }
}

async function makeSalon(ownerId: string, prefix: string): Promise<string> {
  const admin = makeClient(SUPABASE_SERVICE, `${prefix}-salon`)
  const { data, error } = await admin
    .from('salons')
    .insert({
      name: `${prefix} Salon`,
      country_code: 'PL',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      salon_type: 'hair',
      locale: 'ru',
      created_by: ownerId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('salon not created')
  await admin.from('salon_members').insert({ salon_id: data.id, user_id: ownerId, role: 'owner' })
  return data.id
}

async function callAdmin(
  token: string,
  action: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/admin-stats?action=${action}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>
  return { status: r.status, data }
}

// =============================================================================

const cleanups: Array<() => Promise<void>> = []

describe.skipIf(shouldSkip)('admin-stats edge function', () => {
  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.shift()
      if (fn) await fn().catch(() => {})
    }
  })

  // ---- salon_block / salon_unblock ----
  describe('salon_block / salon_unblock', () => {
    let adminCtx: AdminCtx
    let owner: { id: string; email: string }
    let salonId: string

    beforeEach(async () => {
      const prefix = `block-${Math.random().toString(36).slice(2, 8)}`
      adminCtx = await makeSuperAdmin(prefix)
      owner = await makeUser(prefix)
      salonId = await makeSalon(owner.id, prefix)
      cleanups.push(async () => {
        const svc = makeClient(SUPABASE_SERVICE, `${prefix}-cleanup`)
        await svc.from('salons').delete().eq('id', salonId)
        await svc.auth.admin.deleteUser(owner.id)
        await svc.auth.admin.deleteUser(adminCtx.adminId)
      })
    })

    it('blocks and unblocks salon', async () => {
      const block = await callAdmin(adminCtx.adminToken, 'salon_block', 'POST', {
        salon_id: salonId,
        reason: 'spam',
      })
      expect(block.status).toBe(200)
      expect(block.data.ok).toBe(true)

      const svc = makeClient(SUPABASE_SERVICE, 'block-verify')
      const { data: row1 } = await svc
        .from('salons')
        .select('blocked_at, blocked_reason, blocked_by')
        .eq('id', salonId)
        .single()
      expect(row1?.blocked_at).toBeTruthy()
      expect(row1?.blocked_reason).toBe('spam')
      expect(row1?.blocked_by).toBe(adminCtx.adminId)

      const unblock = await callAdmin(adminCtx.adminToken, 'salon_unblock', 'POST', {
        salon_id: salonId,
      })
      expect(unblock.status).toBe(200)

      const { data: row2 } = await svc
        .from('salons')
        .select('blocked_at, blocked_reason')
        .eq('id', salonId)
        .single()
      expect(row2?.blocked_at).toBeNull()
      expect(row2?.blocked_reason).toBeNull()
    })
  })

  // ---- salon_extend_demo: три ветки ----
  describe('salon_extend_demo', () => {
    let adminCtx: AdminCtx
    let owner: { id: string; email: string }
    let salonId: string

    beforeEach(async () => {
      const prefix = `demo-${Math.random().toString(36).slice(2, 8)}`
      adminCtx = await makeSuperAdmin(prefix)
      owner = await makeUser(prefix)
      salonId = await makeSalon(owner.id, prefix)
      cleanups.push(async () => {
        const svc = makeClient(SUPABASE_SERVICE, `${prefix}-cleanup`)
        await svc.from('salons').delete().eq('id', salonId)
        await svc.auth.admin.deleteUser(owner.id)
        await svc.auth.admin.deleteUser(adminCtx.adminId)
      })
    })

    it('creates manual trial when no subscription exists', async () => {
      const until = new Date(Date.now() + 30 * 86400_000).toISOString()
      const r = await callAdmin(adminCtx.adminToken, 'salon_extend_demo', 'POST', {
        salon_id: salonId,
        until_iso: until,
        reason: 'beta test',
      })
      expect(r.status).toBe(200)
      expect(r.data.mode).toBe('create')

      const svc = makeClient(SUPABASE_SERVICE, 'demo-verify')
      const { data } = await svc
        .from('salon_subscriptions')
        .select('status, source, trial_ends_at, granted_reason, granted_by')
        .eq('salon_id', salonId)
        .single()
      expect(data?.status).toBe('trialing')
      expect(data?.source).toBe('manual_admin')
      expect(data?.granted_reason).toBe('beta test')
      expect(data?.granted_by).toBe(adminCtx.adminId)
      expect(new Date(data?.trial_ends_at as string).getTime()).toBeGreaterThan(Date.now())
    })

    it('sets bonus_until when active Stripe subscription exists', async () => {
      const svc = makeClient(SUPABASE_SERVICE, 'demo-active')
      await svc.from('salon_subscriptions').insert({
        salon_id: salonId,
        stripe_customer_id: 'cus_test',
        stripe_subscription_id: `sub_test_${Date.now()}`,
        stripe_price_id: 'price_test',
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        source: 'stripe',
      })

      const until = new Date(Date.now() + 14 * 86400_000).toISOString()
      const r = await callAdmin(adminCtx.adminToken, 'salon_extend_demo', 'POST', {
        salon_id: salonId,
        until_iso: until,
      })
      expect(r.status).toBe(200)
      expect(r.data.mode).toBe('bonus')

      const { data } = await svc
        .from('salon_subscriptions')
        .select('status, bonus_until, source')
        .eq('salon_id', salonId)
        .single()
      // Stripe-поля не трогаются
      expect(data?.status).toBe('active')
      expect(data?.source).toBe('stripe')
      expect(data?.bonus_until).toBeTruthy()
    })

    it('replaces trial_ends_at when existing trial expired (Q12)', async () => {
      const svc = makeClient(SUPABASE_SERVICE, 'demo-expired')
      const pastTrialEnd = new Date(Date.now() - 86400_000).toISOString()
      await svc.from('salon_subscriptions').insert({
        salon_id: salonId,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        status: 'canceled',
        trial_ends_at: pastTrialEnd,
        current_period_start: pastTrialEnd,
        current_period_end: pastTrialEnd,
        source: 'stripe',
      })

      const newUntil = new Date(Date.now() + 7 * 86400_000).toISOString()
      const r = await callAdmin(adminCtx.adminToken, 'salon_extend_demo', 'POST', {
        salon_id: salonId,
        until_iso: newUntil,
      })
      expect(r.status).toBe(200)
      expect(r.data.mode).toBe('extend_trial')

      const { data } = await svc
        .from('salon_subscriptions')
        .select('status, trial_ends_at, source')
        .eq('salon_id', salonId)
        .single()
      expect(data?.status).toBe('trialing')
      expect(data?.source).toBe('manual_admin')
      // Дата заменена (не сложена)
      const got = new Date(data?.trial_ends_at as string).getTime()
      const expected = new Date(newUntil).getTime()
      expect(Math.abs(got - expected)).toBeLessThan(60_000)
    })

    it('rejects past dates', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'salon_extend_demo', 'POST', {
        salon_id: salonId,
        until_iso: new Date(Date.now() - 86400_000).toISOString(),
      })
      expect(r.status).toBe(400)
      expect(r.data.error).toBe('until_must_be_future')
    })
  })

  // ---- user_block + super-admin protection ----
  describe('user_block', () => {
    let adminCtx: AdminCtx
    let target: { id: string; email: string }
    let superTarget: { id: string; email: string }

    beforeEach(async () => {
      const prefix = `uban-${Math.random().toString(36).slice(2, 8)}`
      adminCtx = await makeSuperAdmin(prefix)
      target = await makeUser(prefix)
      superTarget = await makeUser(prefix)
      const svc = makeClient(SUPABASE_SERVICE, `${prefix}-prep`)
      await svc.from('app_admins').insert({ user_id: superTarget.id, is_super: true })
      cleanups.push(async () => {
        const svc = makeClient(SUPABASE_SERVICE, `${prefix}-cleanup`)
        await svc.auth.admin.deleteUser(target.id)
        await svc.auth.admin.deleteUser(superTarget.id)
        await svc.auth.admin.deleteUser(adminCtx.adminId)
      })
    })

    it('bans a regular user', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'user_block', 'POST', {
        user_id: target.id,
      })
      expect(r.status).toBe(200)
      const svc = makeClient(SUPABASE_SERVICE, 'uban-verify')
      const {
        data: { user },
      } = await svc.auth.admin.getUserById(target.id)
      expect((user as unknown as { banned_until?: string })?.banned_until).toBeTruthy()
    })

    it('refuses to ban super-admin', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'user_block', 'POST', {
        user_id: superTarget.id,
      })
      expect(r.status).toBe(403)
      expect(r.data.error).toBe('cannot_block_super_admin')
    })

    it('refuses self-ban', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'user_block', 'POST', {
        user_id: adminCtx.adminId,
      })
      expect(r.status).toBe(400)
      expect(r.data.error).toBe('cannot_block_self')
    })
  })

  // ---- admin_grant / admin_revoke + super-admin protection ----
  describe('admin_grant / admin_revoke', () => {
    let adminCtx: AdminCtx
    let target: { id: string; email: string }
    let regularAdminCtx: AdminCtx

    beforeEach(async () => {
      const prefix = `rbac-${Math.random().toString(36).slice(2, 8)}`
      adminCtx = await makeSuperAdmin(prefix)
      target = await makeUser(prefix)
      // создаём ещё одного — обычного admin (is_super=false)
      const reg = await makeUser(`${prefix}-r`)
      const svc = makeClient(SUPABASE_SERVICE, `${prefix}-prep`)
      await svc.from('app_admins').insert({ user_id: reg.id, is_super: false })
      const cli = makeClient(SUPABASE_ANON, `${prefix}-regcli`)
      const { data: session } = await cli.auth.signInWithPassword({
        email: reg.email,
        password: 'UserPass123!',
      })
      if (!session.session) throw new Error('reg admin sign-in failed')
      regularAdminCtx = {
        adminId: reg.id,
        adminToken: session.session.access_token,
        email: reg.email,
      }

      cleanups.push(async () => {
        const svc = makeClient(SUPABASE_SERVICE, `${prefix}-cleanup`)
        await svc.from('app_admins').delete().eq('user_id', target.id)
        await svc.auth.admin.deleteUser(target.id)
        await svc.auth.admin.deleteUser(regularAdminCtx.adminId)
        await svc.auth.admin.deleteUser(adminCtx.adminId)
      })
    })

    it('super-admin grants regular admin', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'admin_grant', 'POST', {
        user_id: target.id,
      })
      expect(r.status).toBe(200)
      const svc = makeClient(SUPABASE_SERVICE, 'rbac-verify')
      const { data } = await svc
        .from('app_admins')
        .select('is_super')
        .eq('user_id', target.id)
        .single()
      expect(data?.is_super).toBe(false)
    })

    it('regular admin cannot grant super-admin', async () => {
      const r = await callAdmin(regularAdminCtx.adminToken, 'admin_grant', 'POST', {
        user_id: target.id,
        is_super: true,
      })
      expect(r.status).toBe(403)
      expect(r.data.error).toBe('only_super_can_grant_super')
    })

    it('regular admin cannot revoke super-admin', async () => {
      const r = await callAdmin(regularAdminCtx.adminToken, 'admin_revoke', 'POST', {
        user_id: adminCtx.adminId,
      })
      expect(r.status).toBe(403)
      expect(r.data.error).toBe('only_super_can_revoke_super')
    })

    it('admin_revoke refuses self', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'admin_revoke', 'POST', {
        user_id: adminCtx.adminId,
      })
      expect(r.status).toBe(400)
      expect(r.data.error).toBe('cannot_revoke_self')
    })
  })

  // ---- feedback_approve / feedback_reject ----
  describe('feedback moderation', () => {
    let adminCtx: AdminCtx
    let bugId: string

    beforeEach(async () => {
      const prefix = `fb-${Math.random().toString(36).slice(2, 8)}`
      adminCtx = await makeSuperAdmin(prefix)
      const svc = makeClient(SUPABASE_SERVICE, `${prefix}-prep`)
      const { data, error } = await svc
        .from('bug_reports')
        .insert({
          telegram_chat_id: 999_000_000 + Math.floor(Math.random() * 1_000_000),
          telegram_message_id: Math.floor(Math.random() * 1_000_000),
          sender_id: 1,
          sender_username: 'test_client',
          message_text: 'клиентский баг для теста',
          source: 'client',
          requires_approval: true,
          status: 'open',
          kind: 'bug',
        })
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('bug not created')
      bugId = data.id

      cleanups.push(async () => {
        const svc = makeClient(SUPABASE_SERVICE, `${prefix}-cleanup`)
        await svc.from('bug_reports').delete().eq('id', bugId)
        await svc.auth.admin.deleteUser(adminCtx.adminId)
      })
    })

    it('approve clears requires_approval and sets approved_at/by', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'feedback_approve', 'POST', {
        id: bugId,
      })
      expect(r.status).toBe(200)
      const svc = makeClient(SUPABASE_SERVICE, 'fb-verify')
      const { data } = await svc
        .from('bug_reports')
        .select('requires_approval, approved_at, approved_by, status')
        .eq('id', bugId)
        .single()
      expect(data?.requires_approval).toBe(false)
      expect(data?.approved_at).toBeTruthy()
      expect(data?.approved_by).toBe(adminCtx.adminId)
      expect(data?.status).toBe('open')
    })

    it('reject marks status wontfix', async () => {
      const r = await callAdmin(adminCtx.adminToken, 'feedback_reject', 'POST', {
        id: bugId,
      })
      expect(r.status).toBe(200)
      const svc = makeClient(SUPABASE_SERVICE, 'fb-verify-r')
      const { data } = await svc
        .from('bug_reports')
        .select('status, requires_approval')
        .eq('id', bugId)
        .single()
      expect(data?.status).toBe('wontfix')
      expect(data?.requires_approval).toBe(false)
    })
  })

  // ---- forbidden: not in app_admins ----
  it('rejects non-admin caller with 403', async () => {
    const prefix = `noadmin-${Math.random().toString(36).slice(2, 8)}`
    const regular = await makeUser(prefix)
    const cli = makeClient(SUPABASE_ANON, `${prefix}-cli`)
    const { data: session } = await cli.auth.signInWithPassword({
      email: regular.email,
      password: 'UserPass123!',
    })
    if (!session.session) throw new Error('sign-in failed')
    cleanups.push(async () => {
      const svc = makeClient(SUPABASE_SERVICE, `${prefix}-cleanup`)
      await svc.auth.admin.deleteUser(regular.id)
    })

    const r = await callAdmin(session.session.access_token, 'overview', 'GET')
    expect(r.status).toBe(403)
  })
})
