/**
 * generate-insights — еженедельная генерация AI-инсайтов для салонов.
 *
 * Поток:
 *   1) Cron в SQL (process_weekly_insights) → токен в insight_triggers →
 *      pg_net.http_post сюда с {token, cron: true}
 *   2) Валидируем token через rendezvous (тот же паттерн что у digest)
 *   3) Для каждого активного салона:
 *      a) RPC insights_salon_data → агрегаты (staff load, services,
 *         expenses MoM, lost VIPs, cashflow)
 *      b) Прогоняем 5 rules в TS — собираем findings (severity/title/body/payload)
 *      c) Haiku polish: даёт более естественный текст + ranking важности
 *      d) Сохраняем топ-3 в insights table
 *   4) Удаляем старые инсайты (>30 дней) чтобы таблица не росла
 *
 * Auth: token-based. deploy --no-verify-jwt.
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendPushToUser } from '../_shared/web-push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(cents / 100)
}

// =============================================================================
// Rules engine (TypeScript)
// =============================================================================

type SalonData = {
  currency: string
  salon_name: string
  staff: { staff_id: string; full_name: string; visits_4w: number; revenue_4w: number }[]
  services: {
    service_id: string
    name: string
    default_price_cents: number
    visits_30d: number
    revenue_30d: number
  }[]
  expense_categories: {
    id: string
    name: string
    current_month: number
    prev_month: number
  }[]
  lost_vips: {
    id: string
    name: string
    last_visit_at: string
    total_revenue_cents: number
  }[]
  current_month_revenue: number
  current_month_expense: number
}

type RawFinding = {
  kind: string
  severity: 'info' | 'warning' | 'critical'
  area: string
  title: string
  body: string
  payload?: Record<string, unknown>
}

function runRules(data: SalonData): RawFinding[] {
  const findings: RawFinding[] = []
  const cur = data.currency

  // Rule 1: Низкая загрузка мастера (<5 визитов за 4 недели = меньше визита в неделю)
  for (const s of data.staff) {
    if (s.visits_4w < 5) {
      findings.push({
        kind: 'low_utilization',
        severity: s.visits_4w === 0 ? 'warning' : 'info',
        area: 'staff',
        title: `${s.full_name}: низкая загрузка`,
        body: `За последние 4 недели ${s.visits_4w} визит${
          s.visits_4w === 1 ? '' : s.visits_4w < 5 ? 'а' : 'ов'
        }. Возможно, стоит проверить расписание или добавить промо.`,
        payload: { staff_id: s.staff_id, visits_4w: s.visits_4w },
      })
    }
  }

  // Rule 2: Услуга без визитов 30+ дней
  for (const sv of data.services) {
    if (sv.visits_30d === 0 && sv.default_price_cents > 0) {
      findings.push({
        kind: 'unused_service',
        severity: 'info',
        area: 'visits',
        title: `Услуга «${sv.name}» простаивает`,
        body: `За 30 дней ни одного визита. Стоит её отключить или продвинуть отдельно.`,
        payload: { service_id: sv.service_id },
      })
    }
  }

  // Rule 3: Категория расходов выросла >30% MoM
  for (const c of data.expense_categories) {
    if (c.prev_month > 0 && c.current_month > c.prev_month) {
      const growth = ((c.current_month - c.prev_month) / c.prev_month) * 100
      if (growth >= 30) {
        findings.push({
          kind: 'expense_growth',
          severity: growth >= 60 ? 'warning' : 'info',
          area: 'expenses',
          title: `«${c.name}»: расходы выросли на ${Math.round(growth)}%`,
          body: `${formatCents(c.prev_month, cur)} → ${formatCents(c.current_month, cur)} к прошлому месяцу. Проверь чеки в этой категории.`,
          payload: { category_id: c.id, growth_pct: Math.round(growth) },
        })
      }
    }
  }

  // Rule 4: Потерянный VIP
  for (const vip of data.lost_vips) {
    const days = Math.floor(
      (Date.now() - new Date(vip.last_visit_at).getTime()) / (1000 * 60 * 60 * 24),
    )
    findings.push({
      kind: 'lost_vip',
      severity: 'warning',
      area: 'clients',
      title: `${vip.name}: давно не приходил${vip.name.match(/а$/i) ? 'а' : ''}`,
      body: `${days} дней с последнего визита. Всего за время ${formatCents(vip.total_revenue_cents, cur)}. Может, написать сообщение?`,
      payload: { client_id: vip.id, days_since_last: days },
    })
  }

  // Rule 5: Кассовый разрыв — расходы текущего месяца уже больше выручки
  if (data.current_month_revenue > 0 && data.current_month_expense > data.current_month_revenue) {
    const diff = data.current_month_expense - data.current_month_revenue
    findings.push({
      kind: 'cashflow_risk',
      severity: 'critical',
      area: 'expenses',
      title: 'Расходы превышают выручку этого месяца',
      body: `Выручка ${formatCents(data.current_month_revenue, cur)}, расходы ${formatCents(data.current_month_expense, cur)} — минус ${formatCents(diff, cur)}. Серьёзная проверка финансов нужна.`,
      payload: {
        revenue: data.current_month_revenue,
        expense: data.current_month_expense,
      },
    })
  }

  return findings
}

// =============================================================================
// AI polish: ранжируем + улучшаем формулировки
// =============================================================================

function systemForLocale(locale: 'ru' | 'pl' | 'en'): string {
  const langInstruction = {
    ru: 'Title and body — in Russian (русский).',
    pl: 'Title and body — in Polish (polski).',
    en: 'Title and body — in English.',
  }[locale]
  return `You help a beauty salon owner make sense of data. I'll give you an array of "raw" findings from a rules-engine. You need to:
1) Pick top-3 MOST important (priority: critical > warning > info, PLUS real action-ability — what to actually do).
2) Rewrite title and body to sound natural, human, no jargon. Body — 1-2 sentences with a concrete recommendation.
3) Preserve kind, severity, area, payload unchanged.

${langInstruction}

Return ONLY a JSON array of top-3 findings in the same shape (no wrapper, no explanations around it).`
}

function normalizeLocale(input: unknown): 'ru' | 'pl' | 'en' {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

async function polishWithAi(
  findings: RawFinding[],
  locale: 'ru' | 'pl' | 'en' = 'ru',
): Promise<RawFinding[]> {
  if (!ANTHROPIC_KEY || findings.length === 0) return findings.slice(0, 3)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: systemForLocale(locale),
        messages: [{ role: 'user', content: JSON.stringify(findings) }],
      }),
    })
    if (!res.ok) {
      console.warn('anthropic polish failed', res.status)
      return findings.slice(0, 3)
    }
    const data = await res.json()
    const block = data.content?.[0]
    if (block?.type !== 'text') return findings.slice(0, 3)
    const match = (block.text as string).match(/\[[\s\S]*\]/)
    if (!match) return findings.slice(0, 3)
    return JSON.parse(match[0]) as RawFinding[]
  } catch (e) {
    console.warn('polishWithAi', e)
    return findings.slice(0, 3)
  }
}

// =============================================================================
// Per-salon processing
// =============================================================================

async function processSalon(admin: SupabaseClient, salonId: string): Promise<number> {
  const { data, error } = await admin.rpc('insights_salon_data', { p_salon_id: salonId })
  if (error) {
    console.warn('insights_salon_data failed', salonId, error.message)
    return 0
  }

  // RPC возвращает jsonb — прокидываем напрямую
  const findings = runRules(data as SalonData)
  if (findings.length === 0) return 0

  // Подтягиваем locale владельца — AI ответит на нужном языке. Fallback ru.
  const { data: ownerProfile } = await admin
    .from('salon_members')
    .select('user_id, profiles!inner(locale)')
    .eq('salon_id', salonId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  type OwnerLocaleRaw = { profiles?: { locale?: string | null } | null }
  const localeRaw = (ownerProfile as OwnerLocaleRaw | null)?.profiles?.locale
  const ownerLocale = normalizeLocale(localeRaw)

  const top3 = await polishWithAi(findings, ownerLocale)

  // Сначала чистим прошлые недосмотренные инсайты (которые юзер не успел dismiss):
  // вместо «копим бесконечно», на каждой неделе — свежие 3.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await admin.from('insights').delete().eq('salon_id', salonId).lt('created_at', cutoff)

  // Insert свежие
  const rows = top3.map((f) => ({
    salon_id: salonId,
    kind: f.kind,
    severity: f.severity,
    area: f.area,
    title: f.title,
    body: f.body,
    payload: f.payload ?? null,
  }))
  const { error: insErr } = await admin.from('insights').insert(rows)
  if (insErr) {
    console.warn('insights insert failed', salonId, insErr.message)
    return 0
  }

  // Push owner'у с top-1 инсайтом если ai_insights не выключены
  try {
    const { data: salon } = await admin
      .from('salons')
      .select('notification_prefs')
      .eq('id', salonId)
      .maybeSingle()
    const prefs = ((salon?.notification_prefs ?? {}) as Record<string, boolean>) || {}
    if (prefs.ai_insights !== false && top3[0]) {
      const { data: ownerRow } = await admin
        .from('salon_members')
        .select('user_id')
        .eq('salon_id', salonId)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle()
      if (ownerRow) {
        const userId = (ownerRow as { user_id: string }).user_id
        await sendPushToUser(admin, userId, {
          title: `🧠 ${top3[0].title}`,
          body: top3[0].body.slice(0, 200),
          url: `/app/${salonId}/dashboard`,
          tag: `insights-${salonId}`,
        })
      }
    }
  } catch (e) {
    console.warn(`insights push failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  return rows.length
}

// =============================================================================
// Cron handler
// =============================================================================

async function handleCron(admin: SupabaseClient, token: string): Promise<Response> {
  // Token rendezvous — same pattern as digest
  const { data: trigger } = await admin
    .from('insight_triggers')
    .select('token, used_at, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (!trigger) return jsonResponse({ error: 'token_not_found' }, 401)
  if (trigger.used_at) return jsonResponse({ error: 'token_already_used' }, 401)
  if (new Date(trigger.expires_at) < new Date()) {
    return jsonResponse({ error: 'token_expired' }, 401)
  }
  await admin
    .from('insight_triggers')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)

  // Перебираем все не-удалённые салоны
  const { data: salons } = await admin.from('salons').select('id').is('deleted_at', null)

  const stats = { total: salons?.length ?? 0, generated: 0, errors: 0 }
  for (const s of salons ?? []) {
    try {
      const n = await processSalon(admin, (s as { id: string }).id)
      if (n > 0) stats.generated += n
    } catch (e) {
      stats.errors++
      console.error('processSalon failed', s, e)
    }
  }

  return jsonResponse({ ok: true, stats })
}

// =============================================================================
// Manual mode (для тестирования и admin force-regenerate per salon)
// =============================================================================

async function handleManual(
  admin: SupabaseClient,
  userJwt: string,
  salonId: string,
): Promise<Response> {
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })
  const { data: userRes } = await userClient.auth.getUser()
  if (!userRes?.user) return jsonResponse({ error: 'invalid_token' }, 401)

  // Проверка членства через RLS
  const { data: salon } = await userClient
    .from('salons')
    .select('id')
    .eq('id', salonId)
    .maybeSingle()
  if (!salon) return jsonResponse({ error: 'no_access' }, 403)

  const n = await processSalon(admin, salonId)
  return jsonResponse({ ok: true, mode: 'manual', generated: n })
}

import { withSentry } from '../_shared/sentry.ts'

Deno.serve(
  withSentry('generate-insights', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ error: 'function_not_configured' }, 500)
    }

    let body: { salon_id?: string; token?: string; cron?: boolean }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'bad_request' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (body.cron && body.token) return handleCron(admin, body.token)

    // Manual mode — JWT
    const auth = req.headers.get('Authorization') ?? ''
    if (!auth.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)
    if (!body.salon_id) return jsonResponse({ error: 'salon_id_required' }, 400)
    return handleManual(admin, auth.slice('Bearer '.length), body.salon_id)
  }),
)
