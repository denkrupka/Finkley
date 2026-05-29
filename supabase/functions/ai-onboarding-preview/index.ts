/**
 * ai-onboarding-preview — реальный AI-анализ на WOW-шаге онбординга.
 *
 * Принимает «данные с шагов» (salon_type, country, integrations, masters_count,
 * services_count, company_name, has_google_place, ocr_visits_count) — БЕЗ
 * salon_id (салон ещё не создан). Возвращает {insights: [{title, body}]} —
 * 3-4 кратких выгоды на основе того, что юзер уже ввёл.
 *
 * Это не «приснимок реальных финансов» (для этого нужен импорт визитов),
 * а «что AI рекомендует сделать первым» исходя из контекста салона.
 *
 * Модель: Claude Haiku 4.5 (быстрый, дешёвый).
 * Auth: любой залогиненный юзер.
 */

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

type Insight = {
  /** Иконка-якорь: 'staff' | 'services' | 'bookings' | 'banking' | 'social' | 'google' | 'company' | 'general'. */
  icon: string
  /** Headline (1 фраза до 60 символов). */
  title: string
  /** Что AI рекомендует делать или что подтянется (1-2 предложения). */
  body: string
}

type OnboardingPayload = {
  salon_type?: string
  country?: string
  integrations?: string[]
  masters_count?: number
  services_count?: number
  has_google_place?: boolean
  has_nip?: boolean
  company_name?: string
  ocr_visits_count?: number
  locale?: string
  /** T144 — режим ответа:
   *   - 'insights' (default) — 3-4 короткие карточки для StepWowAi
   *   - 'full_summary' — overview + список советов с приоритетом для StepAiSummary
   *   - 'breakdown' — конкретная тема (services/staff/clients/reviews)
   *     для StepAiBreakdown. Возвращает insights[3] с title/body/chip.
   */
  mode?: 'insights' | 'full_summary' | 'breakdown'
  /** Для mode='breakdown' — какую тему анализируем. */
  topic?: 'services' | 'staff' | 'clients' | 'reviews'
  /** D1+ — если early-create salon уже произошёл, передаём salon_id.
   *  Edge function подгружает реальные данные (visits/staff/services/
   *  clients/integrations) из БД и подаёт Claude'у в prompt. */
  salon_id?: string
}

/** D1+ — реальные данные из БД для конкретного salon_id.
 *  T228 — расширено: staff/services идут не только агрегатами из visits,
 *  но и прямыми списками из staff/services таблиц (с именами/ценами/
 *  payout). Это даёт AI контекст даже если Booksy импорт ещё не
 *  закончился (визитов нет, но мастера и услуги уже есть). */
type StaffRow = {
  id: string
  name: string
  payout_percent: number | null
  payout_scheme: string | null
  is_active: boolean
}

type ServiceRow = {
  id: string
  name: string
  category_id: string | null
  price_cents: number
  duration_min: number | null
}

type VisitAgg = {
  count: number
  revenue_cents: number
  avg_check_cents: number
}

type SalonRealData = {
  /** Метаданные салона. */
  salon: {
    name: string
    salon_type: string | null
    country_code: string | null
    timezone: string | null
    company_name: string | null
    nip: string | null
  }
  /** Числа. */
  visits_total: number
  revenue_total_cents: number
  staff_total: number
  services_total: number
  clients_total: number
  reviews_total: number
  /** Списки реальных сущностей — с именами. */
  staff: StaffRow[]
  services: ServiceRow[]
  /** Аналитика визитов по окнам времени. */
  visits_last_30d: VisitAgg
  visits_last_60d: VisitAgg
  visits_last_90d: VisitAgg
  /** Топ-аналитика по визитам (если визиты есть). */
  top_services: Array<{ name: string; visits: number; revenue_cents: number }>
  top_staff: Array<{
    name: string
    visits: number
    revenue_cents: number
    retention_pct: number | null
  }>
  /** Reviews aggregates. */
  reviews_avg_rating: number | null
  reviews_5_star: number
  reviews_1_2_star: number
  /** Интеграции. */
  connected_integrations: string[]
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function normalizeLocale(input: unknown): 'ru' | 'pl' | 'en' {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

function systemForLocale(
  locale: 'ru' | 'pl' | 'en',
  mode: 'insights' | 'full_summary' | 'breakdown',
  topic?: string,
): string {
  const langInstruction = {
    ru: 'Отвечай по-русски. Кратко, без воды, по-деловому, как опытный аналитик-консультант.',
    pl: 'Odpowiadaj po polsku. Zwięźle, bez lania wody, rzeczowo, jak doświadczony analityk-konsultant.',
    en: 'Reply in English. Concise, no fluff, business-like, like an experienced analyst-consultant.',
  }[locale]

  // T228 — общие правила для всех режимов: «AI знает всё».
  const groundingRules = `
GROUNDING RULES (CRITICAL):
- You ALWAYS get a "REAL DATA" block with the salon's actual staff list, services catalog, visits aggregates, reviews. USE IT.
- ALWAYS reference REAL names from STAFF LIST and SERVICES CATALOG (e.g. "Solomia leads by revenue", "Cut & Color — 320 PLN top-priced service").
- NEVER write phrases like "you have 0 masters" or "0 services" — instead say "your team of N masters" using the staff_total number, and pick concrete names.
- If the real_data block has empty arrays (e.g. zero visits, zero reviews), DO NOT pretend you don't know anything: pivot to the static lists (staff catalog, services catalog) which are populated by Booksy import, and write what AI WILL deliver once visits accumulate.
- If staff_total > 0 but top_staff is empty (no visits yet), reference staff BY NAME from the staff list and write "as visits come in, AI will rank {Name1}, {Name2}, {Name3} by revenue / retention / margin".
- Same for services: if visits are empty but services_total > 0, pick 2-3 names from the services catalog and tease AI's planned analytics.
- Use specific numbers from real data: counts, money in salon's local currency, retention %, ratings.
- Tone: confident insider voice. "Solomia — твой топ по выручке", "Lesia держит 78% удержания", "Viktoria — требует апсейл-программу".`

  if (mode === 'breakdown') {
    const topicHint =
      topic === 'services'
        ? `Service-level analysis. Use SERVICES CATALOG (price, duration) + TOP SERVICES BY REVENUE (visits/revenue). Cover: highest-margin services (price/duration ratio), what drags margin down, where to raise prices, what to upsell. ALWAYS name specific services from the catalog.`
        : topic === 'staff'
          ? `Per-master analysis. Use STAFF LIST (payout %, active flag) + TOP STAFF BY REVENUE (visits/revenue/retention %). Cover: top performers by revenue, retention champions, who needs a development plan, salon-loyalty vs personal-loyalty index. ALWAYS name specific masters from the staff list.`
          : topic === 'clients'
            ? `Client RFM analysis. Use clients_total + visits aggregates (30d/60d/90d). Cover: Champions/Loyal segments (frequent + high revenue), At-Risk/Sleeping (didn't return), churn after first visit, reactivation message hooks. Reference specific staff names as «их любимый мастер» if top_staff has retention data.`
            : `Reviews analysis. Use reviews aggregates (avg, 5★, 1-2★) + connected_integrations (google/booksy). Cover: what's praised (common phrases in 5★ — use for marketing), what irritates (hidden complaints), filtering 1-4★ vs 5★ → Google flow, automation hooks. If reviews_total=0, reference HOW the auto-request flow works once reviews accumulate.`
    return `You are Finkley's AI Salon Strategist (Claude). Onboarding step: AI Breakdown for topic="${topic}". ${langInstruction}

${groundingRules}

Topic focus: ${topicHint}

Response format — STRICTLY JSON:
{
  "insights": [
    {
      "title": "<headline up to 60 chars, can include a specific staff/service name>",
      "body": "<1-2 sentences with concrete numbers from real_data and named entities>",
      "chip": "<optional short metric badge, e.g. '+12% revenue', 'до 78% удержания', 'топ по выручке'>"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Return EXACTLY 4 insights — not 3, not 5. Four.`
  }
  if (mode === 'full_summary') {
    return `You are Finkley's AI Salon Strategist (Claude). Onboarding step: final summary. ${langInstruction}

${groundingRules}

Based on REAL DATA + the data the owner has entered, deliver a holistic summary of the salon + 4-6 specific actionable advice items prioritized.

Response format — STRICTLY JSON:
{
  "overview": "<2-4 sentences summarizing what you understood about the salon, with real numbers and 1-2 named entities>",
  "advice": [
    {
      "title": "<headline up to 60 chars>",
      "body": "<1-2 sentences with a concrete recommendation>",
      "priority": "high" | "medium" | "low"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Sort advice by priority (high first). Reference specific numbers AND named entities (staff names, service names) from real data.`
  }
  return `You are Finkley's AI Salon Strategist (Claude). Onboarding step: WOW preview. ${langInstruction}

${groundingRules}

Generate insight cards about what AI will deliver for this salon RIGHT NOW (based on real data) and once full activity accumulates. Each insight = one icon-anchored card.

Response format — STRICTLY JSON:
{
  "insights": [
    {
      "icon": "staff" | "services" | "bookings" | "banking" | "social" | "google" | "company" | "general",
      "title": "<headline up to 60 chars, can include specific name>",
      "body": "<1-2 sentences with concrete numbers and at least one named entity from real_data>"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Return EXACTLY 4 insights — not 3, not 5. Four.
Pick icons that match: staff for masters, services for catalog, bookings for Booksy/calendar, banking for PSD2, social for IG/FB/Telegram, google for Google Place, company for NIP.`
}

function buildPrompt(payload: OnboardingPayload, real: SalonRealData | null): string {
  const state = {
    salon_type: payload.salon_type ?? 'unknown',
    country: payload.country ?? 'PL',
    integrations: payload.integrations ?? [],
    masters_count: payload.masters_count ?? 0,
    services_count: payload.services_count ?? 0,
    has_google_place: !!payload.has_google_place,
    company_name: payload.company_name || null,
    ocr_visits_count: payload.ocr_visits_count ?? 0,
  }
  const realBlock = real
    ? `\n\n=== REAL DATA (live from salon's DB right now — use as ground truth, names and numbers are exact) ===
${realDataDigest(real)}
=== END REAL DATA ===`
    : ''
  return `Owner's onboarding state (JSON, what they entered on the wizard):
${JSON.stringify(state, null, 2)}${realBlock}

Use the REAL DATA block as the primary source of truth. Reference REAL staff names and REAL service names from the lists above. Skip generic advice — make it specific to THIS salon.${real ? '' : ' Note: no live DB data was available — generate insights from onboarding state only.'}`
}

/** D1+ — pulls live data from Supabase REST API using service role.
 *  Возвращает null если salon_id невалидный или юзер не имеет доступа
 *  (verified via salon_members).
 *  T228 — расширено: тащим РЕАЛЬНЫЕ списки staff/services из таблиц
 *  (не только агрегаты из visits). Это критично потому что Booksy
 *  import работает асинхронно, и юзер может попасть на AI-шаг ДО того
 *  как визиты залились, но мастера и услуги уже есть. */
async function fetchRealData(salonId: string, userId: string): Promise<SalonRealData | null> {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  }

  // 1) Проверка доступа: юзер должен быть в salon_members.
  const memRes = await fetch(
    `${SUPABASE_URL}/rest/v1/salon_members?select=role&salon_id=eq.${salonId}&user_id=eq.${userId}&limit=1`,
    { headers },
  )
  const memJson = (await memRes.json()) as Array<{ role: string }>
  if (!Array.isArray(memJson) || memJson.length === 0) return null

  const now = Date.now()
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since60 = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString()
  const since90 = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()

  async function getCount(table: string, filter = ''): Promise<number> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=id&salon_id=eq.${salonId}${filter}`,
      { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } },
    )
    const range = r.headers.get('content-range') ?? ''
    const m = range.match(/\/(\d+)$/)
    return m ? Number(m[1]) : 0
  }

  async function fetchSalonMeta(): Promise<SalonRealData['salon']> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/salons?select=name,salon_type,country_code,timezone,company_name,nip&id=eq.${salonId}&limit=1`,
      { headers },
    )
    const rows = (await r.json()) as Array<{
      name: string
      salon_type: string | null
      country_code: string | null
      timezone: string | null
      company_name: string | null
      nip: string | null
    }>
    const row = Array.isArray(rows) ? rows[0] : null
    return {
      name: row?.name ?? '',
      salon_type: row?.salon_type ?? null,
      country_code: row?.country_code ?? null,
      timezone: row?.timezone ?? null,
      company_name: row?.company_name ?? null,
      nip: row?.nip ?? null,
    }
  }

  async function fetchStaffList(): Promise<StaffRow[]> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?select=id,full_name,payout_percent,payout_scheme,is_active&salon_id=eq.${salonId}&deleted_at=is.null&order=is_active.desc,full_name.asc&limit=50`,
      { headers },
    )
    const rows = (await r.json()) as Array<{
      id: string
      full_name: string
      payout_percent: number | string | null
      payout_scheme: string | null
      is_active: boolean
    }>
    if (!Array.isArray(rows)) return []
    return rows.map((r) => ({
      id: r.id,
      name: r.full_name,
      payout_percent: r.payout_percent != null ? Number(r.payout_percent) : null,
      payout_scheme: r.payout_scheme,
      is_active: !!r.is_active,
    }))
  }

  async function fetchServicesList(): Promise<ServiceRow[]> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/services?select=id,name,category_id,default_price_cents,default_duration_min&salon_id=eq.${salonId}&is_archived=eq.false&order=default_price_cents.desc&limit=100`,
      { headers },
    )
    const rows = (await r.json()) as Array<{
      id: string
      name: string
      category_id: string | null
      default_price_cents: number | string
      default_duration_min: number | null
    }>
    if (!Array.isArray(rows)) return []
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category_id: r.category_id,
      price_cents: Number(r.default_price_cents ?? 0),
      duration_min: r.default_duration_min,
    }))
  }

  async function fetchVisitsAgg(sinceIso: string): Promise<VisitAgg> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/visits?select=amount_cents&salon_id=eq.${salonId}&status=eq.paid&visit_at=gte.${sinceIso}&limit=10000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{ amount_cents: number | string }>
    if (!Array.isArray(rows) || rows.length === 0) {
      return { count: 0, revenue_cents: 0, avg_check_cents: 0 }
    }
    const revenue = rows.reduce((acc, x) => acc + Number(x.amount_cents ?? 0), 0)
    return {
      count: rows.length,
      revenue_cents: revenue,
      avg_check_cents: Math.round(revenue / rows.length),
    }
  }

  async function sumRevenue(): Promise<number> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/visits?select=amount_cents&salon_id=eq.${salonId}&status=eq.paid&limit=10000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{ amount_cents: number | string }>
    if (!Array.isArray(rows)) return 0
    return rows.reduce((acc, x) => acc + Number(x.amount_cents ?? 0), 0)
  }

  async function topServicesAgg(): Promise<
    Array<{ name: string; visits: number; revenue_cents: number }>
  > {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/visits?select=service_name_snapshot,amount_cents&salon_id=eq.${salonId}&status=eq.paid&limit=5000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{
      service_name_snapshot: string | null
      amount_cents: number | string
    }>
    if (!Array.isArray(rows)) return []
    const tally = new Map<string, { visits: number; revenue_cents: number }>()
    for (const v of rows) {
      const name = v.service_name_snapshot?.trim()
      if (!name) continue
      const prev = tally.get(name) ?? { visits: 0, revenue_cents: 0 }
      prev.visits += 1
      prev.revenue_cents += Number(v.amount_cents ?? 0)
      tally.set(name, prev)
    }
    return Array.from(tally.entries())
      .sort((a, b) => b[1].revenue_cents - a[1].revenue_cents)
      .slice(0, 5)
      .map(([name, agg]) => ({ name, ...agg }))
  }

  async function topStaffAgg(): Promise<
    Array<{ name: string; visits: number; revenue_cents: number; retention_pct: number | null }>
  > {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/visits?select=staff_id,client_id,amount_cents,staff:staff_id(full_name)&salon_id=eq.${salonId}&status=eq.paid&limit=5000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{
      staff_id: string | null
      client_id: string | null
      amount_cents: number | string
      staff: { full_name: string } | null
    }>
    if (!Array.isArray(rows)) return []
    type Agg = {
      visits: number
      revenue_cents: number
      clients: Map<string, number>
    }
    const tally = new Map<string, Agg>()
    for (const v of rows) {
      const name = v.staff?.full_name?.trim()
      if (!name) continue
      const prev: Agg = tally.get(name) ?? {
        visits: 0,
        revenue_cents: 0,
        clients: new Map<string, number>(),
      }
      prev.visits += 1
      prev.revenue_cents += Number(v.amount_cents ?? 0)
      if (v.client_id) {
        prev.clients.set(v.client_id, (prev.clients.get(v.client_id) ?? 0) + 1)
      }
      tally.set(name, prev)
    }
    return Array.from(tally.entries())
      .sort((a, b) => b[1].revenue_cents - a[1].revenue_cents)
      .slice(0, 5)
      .map(([name, agg]) => {
        const uniq = agg.clients.size
        const returning = Array.from(agg.clients.values()).filter((n) => n >= 2).length
        const retention = uniq > 0 ? Math.round((returning / uniq) * 100) : null
        return {
          name,
          visits: agg.visits,
          revenue_cents: agg.revenue_cents,
          retention_pct: retention,
        }
      })
  }

  async function fetchReviewsAgg(): Promise<{
    total: number
    avg: number | null
    five: number
    one_two: number
  }> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/reviews?select=rating&salon_id=eq.${salonId}&limit=5000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{ rating: number | null }>
    if (!Array.isArray(rows) || rows.length === 0) {
      return { total: 0, avg: null, five: 0, one_two: 0 }
    }
    let sum = 0
    let cnt = 0
    let five = 0
    let oneTwo = 0
    for (const r of rows) {
      const rating = r.rating
      if (rating == null) continue
      sum += rating
      cnt += 1
      if (rating === 5) five += 1
      if (rating === 1 || rating === 2) oneTwo += 1
    }
    return {
      total: rows.length,
      avg: cnt > 0 ? Math.round((sum / cnt) * 10) / 10 : null,
      five,
      one_two: oneTwo,
    }
  }

  async function connectedIntegrations(): Promise<string[]> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/salon_integrations?select=provider,status&salon_id=eq.${salonId}`,
      { headers },
    )
    const rows = (await r.json()) as Array<{ provider: string; status: string }>
    if (!Array.isArray(rows)) return []
    return rows.filter((r) => r.status !== 'disconnected').map((r) => r.provider)
  }

  const [
    salon,
    visits_total,
    revenue_total_cents,
    staff_total,
    services_total,
    clients_total,
    staff,
    services,
    visits_last_30d,
    visits_last_60d,
    visits_last_90d,
    top_services,
    top_staff,
    reviews,
    connected_integrations,
  ] = await Promise.all([
    fetchSalonMeta(),
    getCount('visits'),
    sumRevenue(),
    getCount('staff', '&deleted_at=is.null'),
    getCount('services', '&is_archived=eq.false'),
    getCount('clients', '&deleted_at=is.null'),
    fetchStaffList(),
    fetchServicesList(),
    fetchVisitsAgg(since30),
    fetchVisitsAgg(since60),
    fetchVisitsAgg(since90),
    topServicesAgg(),
    topStaffAgg(),
    fetchReviewsAgg(),
    connectedIntegrations(),
  ])

  return {
    salon,
    visits_total,
    revenue_total_cents,
    staff_total,
    services_total,
    clients_total,
    reviews_total: reviews.total,
    staff,
    services,
    visits_last_30d,
    visits_last_60d,
    visits_last_90d,
    top_services,
    top_staff,
    reviews_avg_rating: reviews.avg,
    reviews_5_star: reviews.five,
    reviews_1_2_star: reviews.one_two,
    connected_integrations,
  }
}

/** Краткий слепок реальных данных для подачи Claude'у — компактный
 *  и человекочитаемый. Содержит ИМЕНА мастеров/услуг чтобы AI мог
 *  использовать их в карточках. */
function realDataDigest(real: SalonRealData): string {
  const fmtMoney = (cents: number) => {
    const cur =
      real.salon.country_code === 'PL' ? 'PLN' : real.salon.country_code === 'UA' ? 'UAH' : 'EUR'
    return `${Math.round(cents / 100)} ${cur}`
  }
  const staff = real.staff.length
    ? real.staff
        .slice(0, 20)
        .map(
          (s) =>
            `- ${s.name}${s.payout_percent != null ? ` (payout ${s.payout_percent}%)` : ''}${s.is_active ? '' : ' [inactive]'}`,
        )
        .join('\n')
    : '(пусто — нет мастеров)'
  const services = real.services.length
    ? real.services
        .slice(0, 30)
        .map(
          (s) =>
            `- ${s.name} — ${fmtMoney(s.price_cents)}${s.duration_min ? ` / ${s.duration_min} мин` : ''}`,
        )
        .join('\n')
    : '(пусто — нет услуг в каталоге)'
  const topSvc = real.top_services.length
    ? real.top_services
        .map((s) => `- ${s.name}: ${s.visits} визитов, ${fmtMoney(s.revenue_cents)}`)
        .join('\n')
    : '(нет визитов за период)'
  const topStaff = real.top_staff.length
    ? real.top_staff
        .map(
          (s) =>
            `- ${s.name}: ${s.visits} визитов, ${fmtMoney(s.revenue_cents)}${s.retention_pct != null ? `, retention ${s.retention_pct}%` : ''}`,
        )
        .join('\n')
    : '(нет визитов с привязкой к мастеру)'
  return `Salon: ${real.salon.name || '(без имени)'} | type: ${real.salon.salon_type ?? '?'} | country: ${real.salon.country_code ?? '?'}
Connected integrations: ${real.connected_integrations.length ? real.connected_integrations.join(', ') : '(none)'}

Counts: staff=${real.staff_total}, services=${real.services_total}, clients=${real.clients_total}, visits=${real.visits_total}, reviews=${real.reviews_total}
Revenue total: ${fmtMoney(real.revenue_total_cents)}
Last 30d: ${real.visits_last_30d.count} visits, ${fmtMoney(real.visits_last_30d.revenue_cents)} (avg ${fmtMoney(real.visits_last_30d.avg_check_cents)})
Last 60d: ${real.visits_last_60d.count} visits, ${fmtMoney(real.visits_last_60d.revenue_cents)}
Last 90d: ${real.visits_last_90d.count} visits, ${fmtMoney(real.visits_last_90d.revenue_cents)}
Reviews: avg=${real.reviews_avg_rating ?? 'n/a'}, 5★=${real.reviews_5_star}, 1-2★=${real.reviews_1_2_star}

STAFF LIST (real, from DB):
${staff}

SERVICES CATALOG (real, from DB, sorted by price desc):
${services}

TOP SERVICES BY REVENUE (real, from visits):
${topSvc}

TOP STAFF BY REVENUE (real, with retention %):
${topStaff}`
}

async function claudeJson(system: string, prompt: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2200,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const block = data.content?.[0]
  if (block?.type !== 'text') throw new Error('claude non-text response')
  const text = (block.text as string).trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('claude returned non-json')
  return JSON.parse(match[0])
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  if (!ANTHROPIC_KEY) return json({ error: 'anthropic_key_missing' }, 500)

  let payload: OnboardingPayload
  try {
    payload = (await req.json()) as OnboardingPayload
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const locale = normalizeLocale(payload.locale)
  const mode: 'insights' | 'full_summary' | 'breakdown' =
    payload.mode === 'full_summary'
      ? 'full_summary'
      : payload.mode === 'breakdown'
        ? 'breakdown'
        : 'insights'

  // D1+ — если есть salon_id и юзер has access — подгружаем реальные данные.
  // Падение fetchRealData не блокирует AI: возвращаем insights только по
  // metadata (legacy mode).
  // T228 — фикс: getUserFromRequest возвращает { userId }, не { id }.
  // Раньше передавался undefined → salon_members проверка возвращала
  // empty → real = null → AI видел только метадату → писал «0 услуг».
  let real: SalonRealData | null = null
  if (payload.salon_id) {
    try {
      real = await fetchRealData(payload.salon_id, user.userId)
    } catch (e) {
      console.warn('fetchRealData failed', e)
    }
  }

  try {
    const result = await claudeJson(
      systemForLocale(locale, mode, payload.topic),
      buildPrompt(payload, real),
    )
    return json(result)
  } catch (e) {
    return json({ error: 'ai_failed', detail: e instanceof Error ? e.message : String(e) }, 502)
  }
})
