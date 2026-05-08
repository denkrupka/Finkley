/**
 * generate-export — собирает ZIP со всеми данными пользователя по всем салонам,
 * куда у него есть membership. Используется для GDPR Art. 20 (Right to Data
 * Portability).
 *
 * Auth: verify-jwt: true. Юзер дёргает только за себя, edge-function через
 * service-role читает полные данные (RLS не мешает).
 *
 * Поток:
 * 1. Из JWT берём user_id.
 * 2. Создаём запись в export_requests со статусом processing.
 * 3. Получаем salon_ids этого юзера.
 * 4. Для каждого салона тянем все таблицы (visits, expenses, clients, staff,
 *    services, expense_categories, salon-meta) → CSV.
 * 5. Складываем в ZIP, кладём в bucket exports/<user_id>/<request_id>.zip.
 * 6. Помечаем запрос done + storage_path. Создаём signed URL на 24h.
 * 7. Зовём send-email с template gdpr_export, передаём signed url.
 * 8. Отдаём {request_id, download_url, expires_at}.
 *
 * Rate-limit: 1 экспорт в день на юзера. Если у него уже был успешный
 * запрос за последние 24h — возвращаем тот же download_url (без пересоздания).
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FUNCTION_INTERNAL_SECRET
 *   APP_URL                  — откуда юзер пришёл (для письма)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import JSZip from 'https://esm.sh/jszip@3.10.1'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
import { buildSummaryPdf, type SalonSummary } from './pdf-summary.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FUNCTION_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

const SIGNED_URL_TTL_SECONDS = 24 * 3600

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0]!)
  const header = cols.join(',')
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')).join('\n')
  return `${header}\n${body}\n`
}

async function fetchAll(
  admin: SupabaseClient,
  table: string,
  salonIds: string[],
): Promise<Record<string, unknown>[]> {
  if (salonIds.length === 0) return []
  const { data, error } = await admin.from(table).select('*').in('salon_id', salonIds).limit(50000)
  if (error) {
    console.warn('fetchAll', { table, error })
    return []
  }
  return (data ?? []) as Record<string, unknown>[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !FUNCTION_SECRET) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  // Auth: достаём user из JWT (verify-jwt стоит true в config.toml)
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const userJwt = authHeader.slice('Bearer '.length)

  // Клиент с user JWT — для проверки auth + чтения через RLS
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })

  const { data: userRes, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userRes?.user) {
    return jsonResponse({ error: 'invalid_token', message: userErr?.message }, 401)
  }
  const userId = userRes.user.id
  const userEmail = userRes.user.email ?? ''

  // Admin-клиент для записи export_requests + Storage upload без RLS
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Rate-limit: если у юзера есть done-экспорт за последние 24h — возвращаем его
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { data: recent, error: recentErr } = await admin
    .from('export_requests')
    .select('id, storage_path, completed_at, status')
    .eq('user_id', userId)
    .eq('status', 'done')
    .gte('completed_at', dayAgo)
    .order('completed_at', { ascending: false })
    .limit(1)
  if (recentErr) {
    return jsonResponse({ error: 'select_recent_failed', message: recentErr.message }, 500)
  }
  if (recent && recent[0] && recent[0].storage_path) {
    const { data: signed, error: signErr } = await admin.storage
      .from('exports')
      .createSignedUrl(recent[0].storage_path, SIGNED_URL_TTL_SECONDS)
    if (signErr) {
      return jsonResponse({ error: 'sign_recent_failed', message: signErr.message }, 500)
    }
    return jsonResponse({
      ok: true,
      cached: true,
      request_id: recent[0].id,
      download_url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
    })
  }

  // Создаём запись запроса
  const { data: requestRow, error: insertErr } = await admin
    .from('export_requests')
    .insert({ user_id: userId, status: 'processing' })
    .select('id')
    .single()
  if (insertErr || !requestRow) {
    return jsonResponse({ error: 'request_insert_failed', message: insertErr?.message }, 500)
  }
  const requestId = requestRow.id as string

  try {
    // 1) Список салонов юзера
    const { data: salonsRows, error: salonsErr } = await userClient
      .from('salons')
      .select('*')
      .limit(100)
    if (salonsErr) throw salonsErr
    const salons = (salonsRows ?? []) as { id: string }[]
    const salonIds = salons.map((s) => s.id)

    // 2) Тянем данные по каждой таблице через admin (включая deleted_at для полноты)
    const [
      members,
      visits,
      expenses,
      expenseCategories,
      clients,
      staff,
      services,
      serviceCategories,
    ] = await Promise.all([
      fetchAll(admin, 'salon_members', salonIds),
      fetchAll(admin, 'visits', salonIds),
      fetchAll(admin, 'expenses', salonIds),
      fetchAll(admin, 'expense_categories', salonIds),
      fetchAll(admin, 'clients', salonIds),
      fetchAll(admin, 'staff', salonIds),
      fetchAll(admin, 'services', salonIds),
      fetchAll(admin, 'service_categories', salonIds),
    ])

    // 3) Профиль (есть ли)
    const { data: profile } = await admin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    // 4) Собираем ZIP
    const zip = new JSZip()
    zip.file(
      'README.txt',
      [
        `Finkley export · ${new Date().toISOString()}`,
        `User: ${userEmail}`,
        ``,
        `Этот архив содержит все данные, привязанные к твоему аккаунту в Finkley,`,
        `по требованию GDPR (Art. 20 «Право на портативность»).`,
        ``,
        `Файлы внутри:`,
        `  summary.pdf             — краткая сводка для аудитора (агрегаты по салонам)`,
        `  profile.csv             — твой профиль`,
        `  salons.csv              — салоны, в которых ты участвуешь`,
        `  salon_members.csv       — членство (роли)`,
        `  staff.csv               — мастера в твоих салонах`,
        `  services.csv            — услуги`,
        `  service_categories.csv  — категории услуг`,
        `  clients.csv             — клиенты`,
        `  visits.csv              — визиты (вся книга записи)`,
        `  expense_categories.csv  — категории расходов`,
        `  expenses.csv            — расходы`,
        ``,
        `Денежные значения в копейках/центах (поля *_cents). Делите на 100,`,
        `чтобы получить значение в основной валюте салона (см. salons.csv → currency).`,
        ``,
        `Файлы чеков (receipts) НЕ включены в архив. Свяжитесь с info@finkley.app,`,
        `если они нужны — предоставим отдельным архивом.`,
      ].join('\n'),
    )
    if (profile) zip.file('profile.csv', rowsToCsv([profile as Record<string, unknown>]))
    zip.file('salons.csv', rowsToCsv(salons as unknown as Record<string, unknown>[]))
    zip.file('salon_members.csv', rowsToCsv(members))
    zip.file('staff.csv', rowsToCsv(staff))
    zip.file('services.csv', rowsToCsv(services))
    zip.file('service_categories.csv', rowsToCsv(serviceCategories))
    zip.file('clients.csv', rowsToCsv(clients))
    zip.file('visits.csv', rowsToCsv(visits))
    zip.file('expense_categories.csv', rowsToCsv(expenseCategories))
    zip.file('expenses.csv', rowsToCsv(expenses))

    // PDF summary — best-effort, не валим экспорт если генерация PDF упадёт
    try {
      const salonSummaries: SalonSummary[] = (
        salons as unknown as Array<{
          id: string
          name: string
          currency: string
          country_code: string | null
        }>
      ).map((s) => {
        const sVisits = visits.filter((v) => v.salon_id === s.id) as Array<{
          amount_cents?: number | null
          tip_cents?: number | null
          discount_cents?: number | null
          visit_at?: string | null
        }>
        const sExpenses = expenses.filter((e) => e.salon_id === s.id) as Array<{
          amount_cents?: number | null
        }>
        const sClients = clients.filter((c) => c.salon_id === s.id)
        const sStaff = staff.filter((st) => st.salon_id === s.id)
        const sServices = services.filter((sv) => sv.salon_id === s.id)
        const visitDates = sVisits
          .map((v) => v.visit_at ?? null)
          .filter((d): d is string => Boolean(d))
          .sort()
        const revenueCents = sVisits.reduce(
          (acc, v) => acc + (v.amount_cents ?? 0) + (v.tip_cents ?? 0) - (v.discount_cents ?? 0),
          0,
        )
        const expensesCents = sExpenses.reduce((acc, e) => acc + (e.amount_cents ?? 0), 0)
        return {
          name: s.name,
          currency: s.currency,
          country: s.country_code,
          visitsCount: sVisits.length,
          revenueCents,
          expensesCount: sExpenses.length,
          expensesCents,
          clientsCount: sClients.length,
          staffCount: sStaff.length,
          servicesCount: sServices.length,
          firstVisitAt: visitDates[0] ?? null,
          lastVisitAt: visitDates[visitDates.length - 1] ?? null,
        }
      })

      const pdfBytes = await buildSummaryPdf({
        userEmail,
        generatedAt: new Date().toISOString(),
        salons: salonSummaries,
      })
      zip.file('summary.pdf', pdfBytes)
    } catch (e) {
      console.warn('PDF summary generation failed, continuing without it', e)
    }

    const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const storagePath = `${userId}/${requestId}.zip`

    // 5) Upload
    const { error: uploadErr } = await admin.storage.from('exports').upload(storagePath, zipBytes, {
      contentType: 'application/zip',
      upsert: true,
    })
    if (uploadErr) throw uploadErr

    // 6) Signed URL
    const { data: signed, error: signErr } = await admin.storage
      .from('exports')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
    if (signErr || !signed) throw signErr ?? new Error('sign_failed')

    // 7) Обновляем запрос
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString()
    await admin
      .from('export_requests')
      .update({
        status: 'done',
        storage_path: storagePath,
        signed_url_expires_at: expiresAt,
        completed_at: new Date().toISOString(),
      })
      .eq('id', requestId)

    // 8) Email с ссылкой (best-effort — не валим запрос если упадёт)
    try {
      const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Finkley-Secret': FUNCTION_SECRET,
        },
        body: JSON.stringify({
          template: 'gdpr_export',
          to: userEmail,
          vars: {
            full_name: userEmail.split('@')[0] ?? 'друг',
            download_url: signed.signedUrl,
            expires_at: expiresAt,
            app_url: APP_URL,
          },
        }),
      })
      if (!emailRes.ok) {
        console.warn('send-email gdpr_export failed', await emailRes.text())
      }
    } catch (e) {
      console.warn('send-email exception', e)
    }

    return jsonResponse({
      ok: true,
      cached: false,
      request_id: requestId,
      download_url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await captureException(err, { fn: 'generate-export', user_id: userId, request_id: requestId })
    await admin
      .from('export_requests')
      .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
      .eq('id', requestId)
    return jsonResponse({ error: 'export_failed', message }, 500)
  }
})
