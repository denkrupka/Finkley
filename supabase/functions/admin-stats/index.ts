/**
 * admin-stats — super-admin endpoint, возвращает агрегированную статистику и
 * выполняет admin-действия над сервисом (используется в /admin/*).
 *
 * Доступ только пользователям из app_admins. Service-role читает БД минуя RLS,
 * но мы вручную проверяем admin-флаг.
 *
 * Endpoints:
 *  GET  ?action=overview
 *  GET  ?action=salons
 *  GET  ?action=users
 *  GET  ?action=feedback
 *  POST ?action=salon_block          body={salon_id,reason?}
 *  POST ?action=salon_unblock        body={salon_id}
 *  POST ?action=salon_delete         body={salon_id}
 *  POST ?action=salon_add_user       body={salon_id,email,role?}
 *  POST ?action=salon_extend_demo    body={salon_id,until_iso,reason?}
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type AdminClient = ReturnType<typeof createClient>

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function isSubscribed(
  sub: {
    status: string
    trial_ends_at: string | null
    bonus_until: string | null
  },
  nowMs: number,
): boolean {
  if (sub.status === 'active' || sub.status === 'past_due') return true
  if (sub.bonus_until && new Date(sub.bonus_until).getTime() > nowMs) return true
  return false
}

function isOnTrial(
  sub: {
    status: string
    trial_ends_at: string | null
  },
  nowMs: number,
): boolean {
  return (
    sub.status === 'trialing' &&
    !!sub.trial_ends_at &&
    new Date(sub.trial_ends_at).getTime() > nowMs
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Проверяем что юзер — app_admin
  const { data: adminRow } = await admin
    .from('app_admins')
    .select('user_id, is_super')
    .eq('user_id', user.userId)
    .maybeSingle()
  if (!adminRow) return jsonResponse({ error: 'forbidden' }, 403)
  const callerIsSuper = !!(adminRow as { is_super?: boolean }).is_super

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'overview'

  // ---- READ actions (GET) ----
  if (req.method === 'GET') {
    if (action === 'overview') return handleOverview(admin)
    if (action === 'salons') return handleSalons(admin)
    if (action === 'users') return handleUsers(admin)
    if (action === 'feedback') return handleFeedback(admin)
    return jsonResponse({ error: 'unknown_action' }, 400)
  }

  // ---- WRITE actions (POST) ----
  if (req.method === 'POST') {
    const body = await readBody(req)
    if (action === 'salon_block') return handleSalonBlock(admin, body, user.userId)
    if (action === 'salon_unblock') return handleSalonUnblock(admin, body)
    if (action === 'salon_delete') return handleSalonDelete(admin, body)
    if (action === 'salon_add_user') return handleSalonAddUser(admin, body)
    if (action === 'salon_extend_demo') return handleSalonExtendDemo(admin, body, user.userId)
    if (action === 'user_block') return handleUserBlock(admin, body, user.userId)
    if (action === 'user_unblock') return handleUserUnblock(admin, body)
    if (action === 'member_role_change') return handleMemberRoleChange(admin, body)
    if (action === 'admin_grant') return handleAdminGrant(admin, body, user.userId, callerIsSuper)
    if (action === 'admin_revoke') return handleAdminRevoke(admin, body, user.userId, callerIsSuper)
    if (action === 'feedback_approve') return handleFeedbackApprove(admin, body, user.userId)
    if (action === 'feedback_reject') return handleFeedbackReject(admin, body)
    if (action === 'feedback_status') return handleFeedbackStatus(admin, body)
    return jsonResponse({ error: 'unknown_action' }, 400)
  }

  return jsonResponse({ error: 'method_not_allowed' }, 405)
})

// =============================================================================
// READ handlers
// =============================================================================

async function handleOverview(admin: AdminClient): Promise<Response> {
  const now = Date.now()
  const sevenDaysAgoIso = new Date(now - 7 * 86400_000).toISOString()
  // Скользящие 12 месяцев — старт = первое число месяца, который был 11 месяцев назад
  const chartStart = new Date(now)
  chartStart.setUTCDate(1)
  chartStart.setUTCHours(0, 0, 0, 0)
  chartStart.setUTCMonth(chartStart.getUTCMonth() - 11)
  const chartStartIso = chartStart.toISOString()

  const [salons, subs, members, visits, authUsersResp] = await Promise.all([
    admin.from('salons').select('id, created_at, blocked_at').is('deleted_at', null),
    admin
      .from('salon_subscriptions')
      .select('salon_id, status, trial_ends_at, current_period_end, bonus_until'),
    admin.from('salon_members').select('user_id', { count: 'exact', head: true }),
    admin.from('visits').select('visit_at').gte('visit_at', chartStartIso),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  if (salons.error) return jsonResponse({ error: salons.error.message }, 500)
  if (subs.error) return jsonResponse({ error: subs.error.message }, 500)

  const salonsList = salons.data ?? []
  const subsList = subs.data ?? []
  const usersList = authUsersResp.data?.users ?? []

  type Sub = {
    salon_id: string
    status: string
    trial_ends_at: string | null
    current_period_end: string | null
    bonus_until: string | null
  }
  const subBySalon = new Map<string, Sub>()
  for (const s of subsList as Sub[]) subBySalon.set(s.salon_id, s)

  let subscribed = 0
  let onTrial = 0
  let trialExpired = 0
  let inactiveNoSub = 0
  let blocked = 0
  for (const s of salonsList) {
    if (s.blocked_at) {
      blocked++
      continue
    }
    const sub = subBySalon.get(s.id)
    if (sub && isSubscribed(sub, now)) {
      subscribed++
    } else if (sub && isOnTrial(sub, now)) {
      onTrial++
    } else if (sub && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() <= now) {
      trialExpired++
    } else if (!sub && new Date(s.created_at).getTime() < new Date(sevenDaysAgoIso).getTime()) {
      inactiveNoSub++
    }
  }

  const memberCount = members.count ?? 0
  const usersTotal = usersList.length
  const activeUsers30d = usersList.filter(
    (u) => u.last_sign_in_at && new Date(u.last_sign_in_at).getTime() > now - 30 * 86400_000,
  ).length

  function monthKey(iso: string): string {
    const d = new Date(iso)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  function emptyMonths(): { month: string; count: number }[] {
    const arr: { month: string; count: number }[] = []
    const d = new Date(chartStart)
    for (let i = 0; i < 12; i++) {
      arr.push({
        month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        count: 0,
      })
      d.setUTCMonth(d.getUTCMonth() + 1)
    }
    return arr
  }
  function tally(items: { iso: string }[]): { month: string; count: number }[] {
    const buckets = emptyMonths()
    const idx = new Map(buckets.map((b, i) => [b.month, i]))
    for (const it of items) {
      const i = idx.get(monthKey(it.iso))
      if (i !== undefined) buckets[i].count++
    }
    return buckets
  }

  const salonsByMonth = tally(
    salonsList
      .filter((s) => new Date(s.created_at).getTime() >= chartStart.getTime())
      .map((s) => ({ iso: s.created_at })),
  )
  const usersByMonth = tally(
    usersList
      .filter((u) => u.created_at && new Date(u.created_at).getTime() >= chartStart.getTime())
      .map((u) => ({ iso: u.created_at as string })),
  )
  const visitsByMonth = tally((visits.data ?? []).map((v) => ({ iso: v.visit_at as string })))

  return jsonResponse({
    salons: {
      total: salonsList.length,
      subscribed,
      on_trial: onTrial,
      trial_expired: trialExpired,
      inactive_no_sub: inactiveNoSub,
      blocked,
    },
    users: { total: usersTotal, members: memberCount, active_30d: activeUsers30d },
    charts: {
      salons_by_month: salonsByMonth,
      users_by_month: usersByMonth,
      visits_by_month: visitsByMonth,
    },
  })
}

async function handleSalons(admin: AdminClient): Promise<Response> {
  const now = Date.now()
  // 12 месяцев назад (для среднемесячных KPI)
  const since = new Date(now - 365 * 86400_000).toISOString()

  const { data: salons, error } = await admin
    .from('salons')
    .select('id, name, currency, created_at, created_by, blocked_at, blocked_reason')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) return jsonResponse({ error: error.message }, 500)

  const salonIds = (salons ?? []).map((s) => s.id as string)

  // KPI: суммы visits/expenses по salon_id за 12 мес
  const [{ data: visits }, { data: expenses }, { data: subs }] = await Promise.all([
    salonIds.length
      ? admin
          .from('visits')
          .select('salon_id, amount_cents, visit_at')
          .gte('visit_at', since)
          .in('salon_id', salonIds)
      : Promise.resolve({ data: [] as unknown[] }),
    salonIds.length
      ? admin
          .from('expenses')
          .select('salon_id, amount_cents, expense_at')
          .gte('expense_at', since.slice(0, 10))
          .in('salon_id', salonIds)
      : Promise.resolve({ data: [] as unknown[] }),
    admin
      .from('salon_subscriptions')
      .select('salon_id, status, trial_ends_at, bonus_until, source'),
  ])

  const revenueBySalon = new Map<string, number>()
  for (const v of (visits ?? []) as { salon_id: string; amount_cents: number }[]) {
    revenueBySalon.set(v.salon_id, (revenueBySalon.get(v.salon_id) ?? 0) + (v.amount_cents ?? 0))
  }
  const expensesBySalon = new Map<string, number>()
  for (const e of (expenses ?? []) as { salon_id: string; amount_cents: number }[]) {
    expensesBySalon.set(e.salon_id, (expensesBySalon.get(e.salon_id) ?? 0) + (e.amount_cents ?? 0))
  }
  const subBySalon = new Map<
    string,
    { status: string; trial_ends_at: string | null; bonus_until: string | null; source: string }
  >()
  for (const s of (subs ?? []) as {
    salon_id: string
    status: string
    trial_ends_at: string | null
    bonus_until: string | null
    source: string
  }[]) {
    subBySalon.set(s.salon_id, {
      status: s.status,
      trial_ends_at: s.trial_ends_at,
      bonus_until: s.bonus_until,
      source: s.source,
    })
  }

  // batch listUsers вместо N+1 getUserById — масштабируется на большое число салонов
  const ownerIds = new Set((salons ?? []).map((s) => s.created_by).filter(Boolean))
  const emailById = new Map<string, string>()
  if (ownerIds.size > 0) {
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of users?.users ?? []) {
      if (ownerIds.has(u.id) && u.email) emailById.set(u.id, u.email)
    }
  }

  return jsonResponse({
    salons: (salons ?? []).map((s) => {
      const createdMs = new Date(s.created_at).getTime()
      const monthsAlive = Math.max(
        1,
        Math.min(12, Math.round((now - createdMs) / (30 * 86400_000))),
      )
      const revenue = revenueBySalon.get(s.id) ?? 0
      const expense = expensesBySalon.get(s.id) ?? 0
      const sub = subBySalon.get(s.id)
      return {
        id: s.id,
        name: s.name,
        currency: s.currency,
        created_at: s.created_at,
        owner_id: s.created_by,
        owner_email: s.created_by ? (emailById.get(s.created_by as string) ?? null) : null,
        plan_status: sub?.status ?? null,
        trial_ends_at: sub?.trial_ends_at ?? null,
        bonus_until: sub?.bonus_until ?? null,
        sub_source: sub?.source ?? null,
        blocked_at: s.blocked_at,
        blocked_reason: s.blocked_reason,
        avg_revenue_cents: Math.round(revenue / monthsAlive),
        avg_expenses_cents: Math.round(expense / monthsAlive),
        avg_profit_cents: Math.round((revenue - expense) / monthsAlive),
      }
    }),
  })
}

async function handleUsers(admin: AdminClient): Promise<Response> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) return jsonResponse({ error: error.message }, 500)

  const [{ data: members }, { data: profiles }, { data: appAdmins }] = await Promise.all([
    admin.from('salon_members').select('user_id, salon_id, role, salons(id, name)'),
    admin.from('profiles').select('id, full_name'),
    admin.from('app_admins').select('user_id, is_super'),
  ])
  const profileById = new Map<string, { full_name: string | null }>()
  for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
    profileById.set(p.id, { full_name: p.full_name })
  }
  const adminById = new Map<string, { is_super: boolean }>()
  for (const a of (appAdmins ?? []) as { user_id: string; is_super: boolean | null }[]) {
    adminById.set(a.user_id, { is_super: !!a.is_super })
  }

  type MemberRow = {
    user_id: string
    salon_id: string
    role: string
    salons: { id: string; name: string } | { id: string; name: string }[] | null
  }
  const salonsByUser = new Map<
    string,
    Array<{ salon_id: string; salon_name: string; role: string }>
  >()
  for (const m of (members ?? []) as MemberRow[]) {
    const arr = salonsByUser.get(m.user_id) ?? []
    const salonField = m.salons
    const salonObj = Array.isArray(salonField) ? salonField[0] : salonField
    arr.push({
      salon_id: m.salon_id,
      salon_name: salonObj?.name ?? '—',
      role: m.role,
    })
    salonsByUser.set(m.user_id, arr)
  }

  return jsonResponse({
    users: (data.users ?? []).map((u) => {
      const profile = profileById.get(u.id)
      const salonsArr = salonsByUser.get(u.id) ?? []
      const fullName = profile?.full_name ?? null
      let firstName: string | null = null
      let lastName: string | null = null
      if (fullName) {
        const parts = fullName.trim().split(/\s+/)
        firstName = parts[0] ?? null
        lastName = parts.slice(1).join(' ') || null
      }
      const adminRow = adminById.get(u.id)
      return {
        id: u.id,
        email: u.email,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
        banned_until: (u as { banned_until?: string }).banned_until ?? null,
        first_name: firstName,
        last_name: lastName,
        app_role: adminRow ? (adminRow.is_super ? 'super_admin' : 'admin') : null,
        salons: salonsArr,
      }
    }),
  })
}

async function handleFeedback(admin: AdminClient): Promise<Response> {
  const { data, error } = await admin
    .from('bug_reports')
    .select(
      'id, telegram_chat_id, sender_username, sender_first_name, message_text, ai_summary, status, severity, kind, area, source, requires_approval, approved_by, approved_at, reporter_user_id, salon_id, reported_at, created_at',
    )
    .order('reported_at', { ascending: false })
    .limit(500)
  if (error && error.code !== '42P01') return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ feedback: data ?? [] })
}

// =============================================================================
// WRITE handlers
// =============================================================================

async function handleSalonBlock(
  admin: AdminClient,
  body: Record<string, unknown>,
  adminId: string,
): Promise<Response> {
  const salonId = body.salon_id
  if (typeof salonId !== 'string') return jsonResponse({ error: 'salon_id_required' }, 400)
  const reason = typeof body.reason === 'string' ? body.reason : null

  const { error } = await admin
    .from('salons')
    .update({
      blocked_at: new Date().toISOString(),
      blocked_reason: reason,
      blocked_by: adminId,
    })
    .eq('id', salonId)
  if (error) return jsonResponse({ error: error.message }, 500)

  await admin.from('audit_log').insert({
    salon_id: salonId,
    user_id: adminId,
    action: 'admin.salon_block',
    entity_type: 'salon',
    entity_id: salonId,
    payload: { reason },
  })
  return jsonResponse({ ok: true })
}

async function handleSalonUnblock(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const salonId = body.salon_id
  if (typeof salonId !== 'string') return jsonResponse({ error: 'salon_id_required' }, 400)
  const { error } = await admin
    .from('salons')
    .update({ blocked_at: null, blocked_reason: null, blocked_by: null })
    .eq('id', salonId)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleSalonDelete(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const salonId = body.salon_id
  if (typeof salonId !== 'string') return jsonResponse({ error: 'salon_id_required' }, 400)

  // 1. Какие user_id имеют ТОЛЬКО этот салон — их auth.users мы удалим.
  const { data: members } = await admin
    .from('salon_members')
    .select('user_id')
    .eq('salon_id', salonId)
  const userIds = (members ?? []).map((m) => m.user_id as string)

  // Считаем сколько у каждого юзера всего салонов
  const usersToDelete: string[] = []
  for (const uid of userIds) {
    const { count } = await admin
      .from('salon_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', uid)
    if ((count ?? 0) <= 1) usersToDelete.push(uid)
  }

  // 2. Удаляем сам салон (cascade зачистит salon_members, visits, expenses и т.д.)
  const { error: delErr } = await admin.from('salons').delete().eq('id', salonId)
  if (delErr) return jsonResponse({ error: delErr.message }, 500)

  // 3. Удаляем auth.users для тех, у кого этот салон был единственный
  for (const uid of usersToDelete) {
    await admin.auth.admin.deleteUser(uid)
  }

  return jsonResponse({ ok: true, deleted_users: usersToDelete.length })
}

async function handleSalonAddUser(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const salonId = body.salon_id
  const email = body.email
  const role = (body.role as string | undefined) ?? 'staff'
  if (typeof salonId !== 'string') return jsonResponse({ error: 'salon_id_required' }, 400)
  if (typeof email !== 'string' || !email.includes('@'))
    return jsonResponse({ error: 'email_required' }, 400)
  if (!['owner', 'admin', 'staff', 'accountant'].includes(role))
    return jsonResponse({ error: 'invalid_role' }, 400)

  // Ищем по email — есть ли юзер
  const { data: usersResp } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const existing = (usersResp?.users ?? []).find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  )

  if (existing) {
    const { error } = await admin
      .from('salon_members')
      .upsert(
        { salon_id: salonId, user_id: existing.id, role, invited_email: email },
        { onConflict: 'salon_id,user_id' },
      )
    if (error) return jsonResponse({ error: error.message }, 500)
    return jsonResponse({ ok: true, mode: 'attached', user_id: existing.id })
  } else {
    // Приглашаем — отправит magic-link, после клика юзер появится в auth.users.
    // Salon_member создаст триггер handle_new_user? Нет, такого триггера нет.
    // Поэтому мы сохраняем "ожидающее приглашение" в salon_members с invited_email
    // и подвяжем при первом логине через onboarding-flow. Но пока — просто invite.
    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { invited_to_salon: salonId, invited_role: role },
    })
    if (invErr) return jsonResponse({ error: invErr.message }, 500)
    if (invited?.user) {
      await admin
        .from('salon_members')
        .upsert(
          { salon_id: salonId, user_id: invited.user.id, role, invited_email: email },
          { onConflict: 'salon_id,user_id' },
        )
    }
    return jsonResponse({ ok: true, mode: 'invited', user_id: invited?.user?.id })
  }
}

async function handleSalonExtendDemo(
  admin: AdminClient,
  body: Record<string, unknown>,
  adminId: string,
): Promise<Response> {
  const salonId = body.salon_id
  const untilIso = body.until_iso
  const reason = typeof body.reason === 'string' ? body.reason : null
  if (typeof salonId !== 'string') return jsonResponse({ error: 'salon_id_required' }, 400)
  if (typeof untilIso !== 'string') return jsonResponse({ error: 'until_iso_required' }, 400)
  const untilTs = new Date(untilIso).getTime()
  if (Number.isNaN(untilTs) || untilTs <= Date.now())
    return jsonResponse({ error: 'until_must_be_future' }, 400)

  const { data: existing } = await admin
    .from('salon_subscriptions')
    .select(
      'id, status, trial_ends_at, bonus_until, source, current_period_start, current_period_end',
    )
    .eq('salon_id', salonId)
    .maybeSingle()

  const nowMs = Date.now()
  let mode: 'create' | 'bonus' | 'extend_trial' = 'create'

  if (!existing) {
    // Нет записи — создаём manual trial
    const { error } = await admin.from('salon_subscriptions').insert({
      salon_id: salonId,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_price_id: null,
      status: 'trialing',
      trial_ends_at: new Date(untilTs).toISOString(),
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(untilTs).toISOString(),
      source: 'manual_admin',
      granted_by: adminId,
      granted_reason: reason,
    })
    if (error) return jsonResponse({ error: error.message }, 500)
    mode = 'create'
  } else if (existing.status === 'active' || existing.status === 'past_due') {
    // Активная Stripe-сабa — продляем через bonus_until (не трогаем Stripe-поля)
    const { error } = await admin
      .from('salon_subscriptions')
      .update({
        bonus_until: new Date(untilTs).toISOString(),
        granted_by: adminId,
        granted_reason: reason,
      })
      .eq('id', existing.id)
    if (error) return jsonResponse({ error: error.message }, 500)
    mode = 'bonus'
  } else {
    // Trial/expired/canceled — заменяем trial_ends_at (Q12: заменяем, не прибавляем)
    const { error } = await admin
      .from('salon_subscriptions')
      .update({
        status: 'trialing',
        trial_ends_at: new Date(untilTs).toISOString(),
        source: 'manual_admin',
        granted_by: adminId,
        granted_reason: reason,
      })
      .eq('id', existing.id)
    if (error) return jsonResponse({ error: error.message }, 500)
    mode = 'extend_trial'
  }

  await admin.from('audit_log').insert({
    salon_id: salonId,
    user_id: adminId,
    action: 'admin.salon_extend_demo',
    entity_type: 'salon_subscription',
    entity_id: salonId,
    payload: { until: new Date(untilTs).toISOString(), reason, mode },
  })
  return jsonResponse({ ok: true, mode })
}

async function handleUserBlock(
  admin: AdminClient,
  body: Record<string, unknown>,
  adminId: string,
): Promise<Response> {
  const userId = body.user_id
  if (typeof userId !== 'string') return jsonResponse({ error: 'user_id_required' }, 400)
  if (userId === adminId) return jsonResponse({ error: 'cannot_block_self' }, 400)

  // Защита супер-админа от блокировки кем угодно
  const { data: target } = await admin
    .from('app_admins')
    .select('is_super')
    .eq('user_id', userId)
    .maybeSingle()
  if (target?.is_super) return jsonResponse({ error: 'cannot_block_super_admin' }, 403)

  // Supabase ban_duration: '876000h' ~= 100 лет
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
  } as { ban_duration: string })
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleUserUnblock(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const userId = body.user_id
  if (typeof userId !== 'string') return jsonResponse({ error: 'user_id_required' }, 400)
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: 'none',
  } as { ban_duration: string })
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleMemberRoleChange(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const salonId = body.salon_id
  const userId = body.user_id
  const role = body.role
  if (typeof salonId !== 'string') return jsonResponse({ error: 'salon_id_required' }, 400)
  if (typeof userId !== 'string') return jsonResponse({ error: 'user_id_required' }, 400)
  if (typeof role !== 'string' || !['owner', 'admin', 'staff', 'accountant'].includes(role))
    return jsonResponse({ error: 'invalid_role' }, 400)

  const { error } = await admin
    .from('salon_members')
    .update({ role })
    .eq('salon_id', salonId)
    .eq('user_id', userId)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleAdminGrant(
  admin: AdminClient,
  body: Record<string, unknown>,
  callerId: string,
  callerIsSuper: boolean,
): Promise<Response> {
  const userId = body.user_id
  const makeSuper = body.is_super === true
  if (typeof userId !== 'string') return jsonResponse({ error: 'user_id_required' }, 400)
  // Только super-admin может назначать новых super-admin
  if (makeSuper && !callerIsSuper) return jsonResponse({ error: 'only_super_can_grant_super' }, 403)

  const { error } = await admin
    .from('app_admins')
    .upsert({ user_id: userId, is_super: makeSuper }, { onConflict: 'user_id' })
  if (error) return jsonResponse({ error: error.message }, 500)

  await admin.from('audit_log').insert({
    salon_id: null,
    user_id: callerId,
    action: 'admin.grant',
    entity_type: 'app_admin',
    entity_id: null,
    payload: { target_user_id: userId, is_super: makeSuper },
  })
  return jsonResponse({ ok: true })
}

async function handleAdminRevoke(
  admin: AdminClient,
  body: Record<string, unknown>,
  callerId: string,
  callerIsSuper: boolean,
): Promise<Response> {
  const userId = body.user_id
  if (typeof userId !== 'string') return jsonResponse({ error: 'user_id_required' }, 400)
  if (userId === callerId) return jsonResponse({ error: 'cannot_revoke_self' }, 400)

  // Проверяем target — если super, может отозвать только другой super
  const { data: target } = await admin
    .from('app_admins')
    .select('is_super')
    .eq('user_id', userId)
    .maybeSingle()
  if (!target) return jsonResponse({ error: 'not_an_admin' }, 404)
  if (target.is_super && !callerIsSuper)
    return jsonResponse({ error: 'only_super_can_revoke_super' }, 403)

  const { error } = await admin.from('app_admins').delete().eq('user_id', userId)
  if (error) return jsonResponse({ error: error.message }, 500)

  await admin.from('audit_log').insert({
    salon_id: null,
    user_id: callerId,
    action: 'admin.revoke',
    entity_type: 'app_admin',
    entity_id: null,
    payload: { target_user_id: userId },
  })
  return jsonResponse({ ok: true })
}

async function handleFeedbackApprove(
  admin: AdminClient,
  body: Record<string, unknown>,
  adminId: string,
): Promise<Response> {
  const id = body.id
  if (typeof id !== 'string') return jsonResponse({ error: 'id_required' }, 400)
  const { error } = await admin
    .from('bug_reports')
    .update({
      approved_by: adminId,
      approved_at: new Date().toISOString(),
      requires_approval: false,
    })
    .eq('id', id)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleFeedbackReject(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const id = body.id
  if (typeof id !== 'string') return jsonResponse({ error: 'id_required' }, 400)
  // Отклонённые отмечаем status='wontfix' и approved=true (чтоб не висели в очереди)
  const { error } = await admin
    .from('bug_reports')
    .update({
      status: 'wontfix',
      approved_at: new Date().toISOString(),
      requires_approval: false,
    })
    .eq('id', id)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleFeedbackStatus(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const id = body.id
  const status = body.status
  if (typeof id !== 'string') return jsonResponse({ error: 'id_required' }, 400)
  if (
    typeof status !== 'string' ||
    !['open', 'in_progress', 'fixed', 'wontfix', 'duplicate'].includes(status)
  )
    return jsonResponse({ error: 'invalid_status' }, 400)
  const { error } = await admin.from('bug_reports').update({ status }).eq('id', id)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}
