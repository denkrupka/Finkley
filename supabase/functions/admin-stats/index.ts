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
    const [salons, members, visits, expenses, messages, integrations] = await Promise.all([
      admin.from('salons').select('id, currency, created_at, plan_status:plan_status', {
        count: 'exact',
        head: false,
      }),
      admin.from('salon_members').select('user_id', { count: 'exact', head: true }),
      admin
        .from('visits')
        .select('id, amount_cents, visit_at', { count: 'exact', head: false })
        .gte('visit_at', new Date(Date.now() - 30 * 86400_000).toISOString()),
      admin
        .from('expenses')
        .select('id, amount_cents', { count: 'exact', head: false })
        .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString()),
      admin.from('messenger_messages').select('id', { count: 'exact', head: true }),
      admin
        .from('messenger_integrations')
        .select('channel, status', { count: 'exact', head: false }),
    ])

    const salonsCount = salons.count ?? salons.data?.length ?? 0
    const memberCount = members.count ?? 0
    const visitsCount = visits.count ?? visits.data?.length ?? 0
    const expensesCount = expenses.count ?? expenses.data?.length ?? 0
    const messagesTotal = messages.count ?? 0

    const visitRevenueCents = (visits.data ?? []).reduce((sum, v) => sum + (v.amount_cents ?? 0), 0)
    const expensesSumCents = (expenses.data ?? []).reduce(
      (sum, e) => sum + (e.amount_cents ?? 0),
      0,
    )

    const activeSalons = (salons.data ?? []).filter(
      (s) =>
        (s as { plan_status?: string }).plan_status === 'active' ||
        (s as { plan_status?: string }).plan_status === 'trialing',
    ).length

    const integrationsBreakdown: Record<string, { connected: number; total: number }> = {}
    for (const i of integrations.data ?? []) {
      const ch = (i as { channel: string }).channel
      const st = (i as { status: string }).status
      if (!integrationsBreakdown[ch]) integrationsBreakdown[ch] = { connected: 0, total: 0 }
      integrationsBreakdown[ch].total++
      if (st === 'connected') integrationsBreakdown[ch].connected++
    }

    return jsonResponse({
      salons: {
        total: salonsCount,
        active: activeSalons,
      },
      users: { total: memberCount },
      last30d: {
        visits: visitsCount,
        revenue_cents: visitRevenueCents,
        expenses: expensesCount,
        expenses_cents: expensesSumCents,
        gross_profit_cents: visitRevenueCents - expensesSumCents,
      },
      messages_total: messagesTotal,
      messenger_integrations: integrationsBreakdown,
    })
  }

  if (action === 'salons') {
    const { data, error } = await admin
      .from('salons')
      .select('id, name, currency, plan_status, created_at, owner_id')
      .order('created_at', { ascending: false })
    if (error) return jsonResponse({ error: error.message }, 500)

    // Подтянем email владельцев батчем
    const ownerIds = Array.from(new Set((data ?? []).map((s) => s.owner_id).filter(Boolean)))
    const emailById = new Map<string, string>()
    for (const id of ownerIds) {
      const { data: u } = await admin.auth.admin.getUserById(id as string)
      if (u?.user?.email) emailById.set(id as string, u.user.email)
    }

    return jsonResponse({
      salons: (data ?? []).map((s) => ({
        ...s,
        owner_email: s.owner_id ? (emailById.get(s.owner_id) ?? null) : null,
      })),
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
