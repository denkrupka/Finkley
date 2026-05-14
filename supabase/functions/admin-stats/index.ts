/**
 * admin-stats — super-admin endpoint, возвращает агрегированную статистику
 * по всему сервису (для /admin/overview, /admin/salons, /admin/users etc).
 *
 * Доступ только пользователям из app_admins. Используем service-role чтобы
 * читать таблицы независимо от RLS (но руками проверяем admin-флаг).
 *
 * Endpoints (через ?action=):
 *   overview        — общая статистика (counts, MRR, etc)
 *   salons          — список всех салонов (id, name, owner_email, plan, created)
 *   users           — список auth.users (id, email, last_sign_in_at, salons_count)
 *   subscriptions   — список активных подписок Stripe
 *   feedback        — последние bug-reports / отзывы
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Проверяем что юзер — app_admin
  const { data: adminRow } = await admin
    .from('app_admins')
    .select('user_id')
    .eq('user_id', user.userId)
    .maybeSingle()
  if (!adminRow) return jsonResponse({ error: 'forbidden' }, 403)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'overview'

  if (action === 'overview') {
    const now = Date.now()
    const sevenDaysAgoIso = new Date(now - 7 * 86400_000).toISOString()
    // Скользящие 12 месяцев — старт = первое число месяца, который был 11 месяцев назад
    const chartStart = new Date(now)
    chartStart.setUTCDate(1)
    chartStart.setUTCHours(0, 0, 0, 0)
    chartStart.setUTCMonth(chartStart.getUTCMonth() - 11)
    const chartStartIso = chartStart.toISOString()

    const [salons, subs, members, visits, authUsersResp] = await Promise.all([
      admin.from('salons').select('id, created_at').is('deleted_at', null),
      admin
        .from('salon_subscriptions')
        .select('salon_id, status, trial_ends_at, current_period_end'),
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
    }
    const subBySalon = new Map<string, Sub>()
    for (const s of subsList as Sub[]) subBySalon.set(s.salon_id, s)

    let subscribed = 0
    let onTrial = 0
    let trialExpired = 0
    let inactiveNoSub = 0
    for (const s of salonsList) {
      const sub = subBySalon.get(s.id)
      if (sub && (sub.status === 'active' || sub.status === 'past_due')) {
        subscribed++
      } else if (
        sub &&
        sub.status === 'trialing' &&
        sub.trial_ends_at &&
        new Date(sub.trial_ends_at).getTime() > now
      ) {
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

    // Месячные гистограммы — 12 точек. Ключ месяца "YYYY-MM"
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
      },
      users: {
        total: usersTotal,
        members: memberCount,
        active_30d: activeUsers30d,
      },
      charts: {
        salons_by_month: salonsByMonth,
        users_by_month: usersByMonth,
        visits_by_month: visitsByMonth,
      },
    })
  }

  if (action === 'salons') {
    const { data, error } = await admin
      .from('salons')
      .select('id, name, currency, created_at, created_by')
      .order('created_at', { ascending: false })
    if (error) return jsonResponse({ error: error.message }, 500)

    const { data: subs } = await admin
      .from('salon_subscriptions')
      .select('salon_id, status, trial_ends_at')
    const subBySalon = new Map<string, { status: string; trial_ends_at: string | null }>()
    for (const s of subs ?? []) {
      subBySalon.set(s.salon_id as string, {
        status: s.status as string,
        trial_ends_at: (s.trial_ends_at as string | null) ?? null,
      })
    }

    const ownerIds = Array.from(new Set((data ?? []).map((s) => s.created_by).filter(Boolean)))
    const emailById = new Map<string, string>()
    for (const id of ownerIds) {
      const { data: u } = await admin.auth.admin.getUserById(id as string)
      if (u?.user?.email) emailById.set(id as string, u.user.email)
    }

    return jsonResponse({
      salons: (data ?? []).map((s) => {
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
        }
      }),
    })
  }

  if (action === 'users') {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (error) return jsonResponse({ error: error.message }, 500)

    // Кол-во салонов на юзера
    const { data: members } = await admin.from('salon_members').select('user_id, salon_id')
    const salonsByUser = new Map<string, number>()
    for (const m of members ?? []) {
      const k = m.user_id as string
      salonsByUser.set(k, (salonsByUser.get(k) ?? 0) + 1)
    }

    return jsonResponse({
      users: (data.users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
        salons_count: salonsByUser.get(u.id) ?? 0,
      })),
    })
  }

  if (action === 'feedback') {
    // Если есть таблица feedback / bug_reports — читаем. Иначе пустой массив.
    const { data, error } = await admin
      .from('bug_reports')
      .select('id, user_id, message, created_at, status')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error && error.code !== '42P01') {
      return jsonResponse({ error: error.message }, 500)
    }
    return jsonResponse({ feedback: data ?? [] })
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
