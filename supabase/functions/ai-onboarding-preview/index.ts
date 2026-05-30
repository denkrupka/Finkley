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
    ru: 'Отвечай по-русски. Говори от первого лица консультанта, на «ты», коротко и хлёстко. Никакого корпоративного тона.',
    pl: 'Odpowiadaj po polsku. Mów od pierwszej osoby konsultanta, na «ty», zwięźle i mocno. Bez korporacyjnego żargonu.',
    en: 'Reply in English. Speak in first person as the consultant, address the owner as "you", short and punchy. No corporate tone.',
  }[locale]

  // T228 + усиление: роль с пруфами + жёсткое анти-вода + grounding-only.
  // Ключевая идея — AI должен звучать как реальный аудитор, который только что
  // открыл финансовый отчёт салона и видит конкретные имена/числа. Никаких
  // generic советов «добавьте больше услуг» — только конкретика с именами
  // мастеров/услуг из snapshot.
  const groundingRules = `
=== ROLE ===
Ты опытный финансовый консультант, провёл аудит 200+ салонов красоты в Польше за последние 7 лет. Знаешь экономику кресла, маржу по типичным услугам (мани/педи/окрашивание/стрижка/массаж), типичный retention, средний чек, payout % мастеров, сезонность. Видел и «золотые» салоны на 80k PLN/мес, и тонущие на 12k. Говоришь как аудитор после первой беседы с владельцем — конкретно, с цифрами, без «общих рекомендаций».

=== GROUNDING RULES (HARD CONSTRAINTS — нарушение = ответ выбрасывается) ===
1. ИСПОЛЬЗУЙ ТОЛЬКО реальные данные из блока "REAL DATA" (staff_list, services_catalog, visits_last_30d/60d/90d, top_staff, top_services, reviews). Не выдумывай цифры, не предполагай чего не знаешь.
2. ВСЕГДА называй РЕАЛЬНЫЕ имена из STAFF LIST и SERVICES CATALOG. Минимум 1 конкретное имя в каждой карточке. Пример: «Сломия — твой топ по выручке (12 визитов за 30д, 3 840 PLN)», а не «у вас есть продуктивные мастера».
3. ВСЕГДА оперируй конкретными числами из real_data: «5 услуг», «3 мастера», «47 визитов за 30 дней», «средний чек 165 PLN», «retention 72%».
4. Если в snapshot реально 0 чего-то — честно говори об этом и давай конкретный next-step: «У тебя 0 визитов в системе — сначала подключи Booksy, потом я покажу топ-3 мастера по марже». Не делай вид что данные есть.
5. Если salon brown (visits_total=0, reviews_total=0, но staff/services есть) — пиши на основе каталога: «Из твоего каталога 5 услуг (X, Y, Z, Q, R) — Z дороже всех (320 PLN), но требует 90 мин. После первых 30 визитов я покажу настоящую маржу по часу».

=== ANTI-FLUFF (запрещённые фразы — за них ответ переписывается) ===
ЗАПРЕЩЕНО писать generic советы без привязки к конкретным данным салона:
- «Добавьте больше услуг» (вместо: «У тебя 5 услуг, но 3 из них (X, Y, Z) принесут 80% выручки — добавь комбо «X+Y» за 350 PLN»)
- «Привлекайте новых клиентов» (вместо: «У тебя 0 повторных клиентов из 12 новых за 30 дней — настрой автонапоминание через 5 недель»)
- «Работайте над качеством» (вместо: «Анна — 4 визита, 3 разных клиента, 0 возвратов. Поставь ей куратора на 2 недели или переведи на 35% payout»)
- «Используйте AI-инструменты», «оптимизируйте процессы», «повышайте эффективность» — это пустые слова, переписывай конкретно
- Любые формулировки в духе «в среднем салоны…» или «лучшие практики говорят…» — у тебя ЕСТЬ данные этого салона, опирайся на них

=== HOW A SENIOR CONSULTANT TALKS ===
ПЛОХО: «Рекомендую проанализировать топ-услуги и поднять цены на маржинальные»
ХОРОШО: «Стрижка+укладка у тебя 120 PLN за 60 мин — это 120 PLN/час. У Сломии загрузка 78% по этой услуге. Подними до 140 PLN — потеряешь 1-2 клиента из 20, заработаешь +800 PLN/мес»

ПЛОХО: «У вас сильная команда мастеров»
ХОРОШО: «Сломия и Леся приносят 64% выручки (3 840 + 3 120 PLN из 10 800 PLN за 30д). Виктория — 8% при равной ставке payout. Это сигнал: или дай Виктории план развития, или пересмотри ставку до 35%»

ПЛОХО: «Отзывы важны для роста»
ХОРОШО: «У тебя 47 отзывов, средний 4.7. Но 9 из 4★ упоминают «долго ждала на ресепшене». Это не про мастеров — это про front-desk. Один найм или Booksy-self-checkin закрывает проблему»`

  if (mode === 'breakdown') {
    const topicHint =
      topic === 'services'
        ? `Service-level audit. Используй SERVICES CATALOG (имя, цена, длительность) + TOP SERVICES BY REVENUE.
Считай PLN/час по каждой названной услуге (price_cents/100 ÷ duration_min × 60).
Что вскрывать:
  • топ-2 услуги по PLN/час (с реальными именами и числом),
  • услуга-якорь с самой длинной продолжительностью при низкой цене (мёртвый груз — назови её и предложи что делать),
  • где поднять цену (с конкретной цифрой "со 120 → 140 PLN"),
  • комбо/апсейл из 2 РЕАЛЬНЫХ услуг каталога ("X + Y за 350 PLN вместо 380").
Если visits_last_30d.count = 0 — пиши "после 30 первых визитов ранжирую X, Y, Z по реальной марже; пока вижу что Z (320 PLN/90 мин) — кандидат №1 на пересмотр длительности".`
        : topic === 'staff'
          ? `Per-master audit. Используй STAFF LIST (имя, payout %) + TOP STAFF BY REVENUE (visits/revenue/retention %).
Что вскрывать:
  • топ-1 по выручке за 30д с реальной цифрой ("Сломия — 3 840 PLN, 12 визитов, retention 78%"),
  • кто отстаёт при равном payout (имя + конкретный план: куратор/смена графика/пересмотр %),
  • salon-loyalty vs personal-loyalty (retention % по имени),
  • кому дать топ-маржинальную услугу из каталога (свяжи 1 staff name + 1 service name).
Если top_staff пустой, но staff_total > 0 — называй людей из STAFF LIST по 2-3 именам и пиши "после первых визитов я покажу кто из них Сломия-уровня, а кто требует плана".`
          : topic === 'clients'
            ? `Client RFM audit. Используй clients_total + visits_last_30d/60d/90d + top_staff с retention.
Что вскрывать:
  • сколько Чемпионов/Лояльных (если есть данные) — с числом,
  • At-Risk: "из N новых за 30д вернулось только M" с конкретной цифрой,
  • кто из мастеров (по имени из top_staff) держит самый высокий retention — туда направлять новых,
  • конкретный hook для реактивации: "сообщение через 5 недель: '{Name} ждёт тебя, скидка 15% на повтор'".
Если clients_total = 0 — пиши конкретно "после Booksy-импорта я разобью базу на 5 RFM-сегментов; уже сейчас вижу что у тебя {staff_total} мастеров и {services_total} услуг — это база для персонализированных рассылок".`
            : `Reviews audit. Используй reviews aggregates (avg, 5★, 1-2★) + connected_integrations.
Что вскрывать:
  • avg рейтинг с интерпретацией ("4.7 — выше средних 4.5 по Польше"),
  • разрыв 5★ vs 1-2★ — что это сигнализирует,
  • flow 5★→Google, 1-4★→владельцу (с конкретным шагом),
  • кто из мастеров (имя из top_staff с retention) — кандидат на персональный профиль в Booksy.
Если reviews_total = 0 — пиши "после подключения Booksy/Google я начну собирать отзывы автоматом; жду пока твои {top_staff_name_1} и {top_staff_name_2} наберут первых клиентов".`
    return `=== CONTEXT ===
Ты на онбординге салона Finkley. Это шаг "AI Breakdown" — углублённый разбор темы "${topic}". Владелец только что подключил интеграции и хочет увидеть что ты УЖЕ знаешь о его салоне. Это его первый wow-момент.

${langInstruction}

${groundingRules}

=== TOPIC FOCUS ===
${topicHint}

=== OUTPUT FORMAT — STRICTLY JSON ===
{
  "insights": [
    {
      "title": "<до 60 символов, ОБЯЗАТЕЛЬНО с именем мастера/услуги из real_data>",
      "body": "<1-2 предложения с конкретными числами из real_data и минимум 1 названным entity>",
      "chip": "<опциональный badge, напр. '+15% к среднему чеку', '78% retention', 'PLN/час: 140'>"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Return EXACTLY 4 insights — не 3, не 5. Ровно четыре.
Каждая карточка ОБЯЗАНА содержать: (1) конкретное имя из STAFF LIST или SERVICES CATALOG, (2) число из real_data, (3) конкретный next-step. Если хотя бы один пункт отсутствует — карточка считается невалидной.`
  }
  if (mode === 'full_summary') {
    return `=== CONTEXT ===
Ты на финальном шаге онбординга Finkley. Владелец прошёл весь wizard. Это твой "первый раппорт после аудита" — он должен закрыть онбординг с ощущением "этот AI уже понимает мой бизнес лучше моей бухгалтерши".

${langInstruction}

${groundingRules}

=== TASK ===
На основе REAL DATA выдай:
1. overview — 2-4 предложения, как будто ты только что закончил первичный аудит. ОБЯЗАТЕЛЬНО: название салона, тип, страна, конкретное число мастеров и услуг, минимум 1 имя мастера или услуги, главный вывод (сильная сторона + одна болевая точка).
2. advice — 4-6 КОНКРЕТНЫХ советов с приоритетом. Каждый совет = конкретное действие на этой неделе с цифрой и именем.

Priority guide:
  • "high" = действие на этой неделе, прямой денежный эффект (поднять цену / закрыть мёртвую услугу / план для отстающего мастера),
  • "medium" = на месяц (комбо/апсейл/настройка автонапоминаний),
  • "low" = стратегия квартала.

=== OUTPUT FORMAT — STRICTLY JSON ===
{
  "overview": "<2-4 предложения с именами и цифрами; никакого «у вас прекрасный салон»>",
  "advice": [
    {
      "title": "<до 60 символов, конкретное действие, желательно с именем>",
      "body": "<1-2 предложения: ЧТО сделать, ПОЧЕМУ это видно из данных, какой эффект ожидать>",
      "priority": "high" | "medium" | "low"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Сортируй advice по priority (high первыми).
Каждый advice ОБЯЗАН содержать: (1) конкретное имя из staff/services, ИЛИ конкретное число из real_data, (2) ожидаемый эффект (в PLN, % или часах).`
  }
  return `=== CONTEXT ===
Ты на WOW-шаге онбординга Finkley. Владелец только что подключил интеграции/добавил мастеров и услуг. Это первый момент когда AI показывает «что я уже вижу». Цель — заставить его сказать «как я раньше работал без этого».

${langInstruction}

${groundingRules}

=== TASK ===
Сгенерируй 4 карточки-инсайта. Каждая карточка = одна конкретная вещь, которую ты УЖЕ видишь в данных салона прямо сейчас, или которую раскроешь после первых визитов.

Mix of cards:
  • 1 карточка про конкретного мастера или услугу из каталога (с именем),
  • 1 карточка про интеграции (что подключено и что это даёт),
  • 1 карточка про следующий шаг владельца (с конкретной цифрой),
  • 1 карточка про долгосрочный эффект (через 30 дней визитов).

Если salon brown (visits_total=0, reviews_total=0):
  • НЕ ПИШИ «нет данных» или «после первых визитов» в каждой карточке — это скучно
  • Опирайся на каталог: имена мастеров, цены услуг, длительности → строй гипотезы аудитора
  • Пример хорошей карточки brown-салона: «У тебя топ-цена 320 PLN — Color & Cut. На обычный фон Польши это premium. Жду первых визитов: уверен что 60%+ выручки придёт с этой и smaller chair-time услуг»

=== OUTPUT FORMAT — STRICTLY JSON ===
{
  "insights": [
    {
      "icon": "staff" | "services" | "bookings" | "banking" | "social" | "google" | "company" | "general",
      "title": "<до 60 символов, ОБЯЗАТЕЛЬНО с именем мастера/услуги или конкретной цифрой>",
      "body": "<1-2 предложения с числами и минимум 1 именованной entity из real_data>"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Return EXACTLY 4 insights.
Pick icons that match: staff для мастеров, services для каталога, bookings для Booksy/календаря, banking для PSD2, social для IG/FB/Telegram, google для Google Place, company для NIP.`
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
  // Усиление: явная классификация состояния салона — Claude'у проще
  // выбирать тон ответа когда «brown / catalog-only / live» сказано напрямую.
  let salonState = 'no_real_data'
  if (real) {
    if (real.visits_total === 0 && real.reviews_total === 0) {
      if (real.staff_total > 0 || real.services_total > 0) salonState = 'catalog_only'
      else salonState = 'brown_empty'
    } else if (real.visits_total === 0 && real.reviews_total > 0) {
      salonState = 'reviews_only'
    } else {
      salonState = 'live'
    }
  }
  const stateHints: Record<string, string> = {
    no_real_data:
      'Реальных данных из БД нет — салон ещё не создан. Опирайся ТОЛЬКО на onboarding state. Никаких выдуманных имён мастеров/услуг. Карточки должны звучать как «что я начну делать как только подключим Booksy и зальются первые визиты».',
    brown_empty:
      'Brown салон: 0 мастеров, 0 услуг, 0 визитов. Не выдумывай имён. Все карточки = «что я раскрою после первых данных». Опирайся на salon_type/country/integrations. Тон: спокойный аудитор, который видел сотни таких стартов.',
    catalog_only:
      'Catalog-only: мастера и/или услуги уже есть в БД, но визитов нет (Booksy импорт идёт или ещё не запущен). ИСПОЛЬЗУЙ конкретные имена из STAFF LIST и SERVICES CATALOG. Не пиши «нет данных» — у тебя есть каталог. Стиль: «вижу твою команду {Name1}, {Name2}, {Name3} — после первых 30 визитов покажу кто из них топ по выручке».',
    reviews_only:
      'Есть отзывы, но нет визитов в системе. Анализируй reviews aggregates. Имена мастеров — из STAFF LIST если есть.',
    live: 'Полный набор данных: visits, staff, services, отзывы. Это твой золотой случай — звучи как реальный аудитор с цифрами и именами в каждой карточке.',
  }
  const realBlock = real
    ? `

=== SALON STATE: ${salonState} ===
${stateHints[salonState]}

=== REAL DATA (live from salon's DB right now — use as ground truth, names and numbers are exact) ===
${realDataDigest(real)}
=== END REAL DATA ===`
    : `

=== SALON STATE: ${salonState} ===
${stateHints[salonState]}`
  return `=== OWNER'S ONBOARDING INPUT (что юзер ввёл в визарде) ===
${JSON.stringify(state, null, 2)}${realBlock}

=== INSTRUCTIONS ===
Используй REAL DATA как единственный источник правды для имён и чисел. Onboarding state — фоновый контекст (тип салона, страна, какие интеграции выбраны).${real ? '' : ' Live DB-данных нет — генерируй карточки только из onboarding state и не выдумывай имён.'}

Финальная проверка перед отправкой ответа:
  • Каждая карточка содержит минимум одно конкретное имя ИЛИ конкретное число из real_data (если real_data есть)?
  • Ни одна карточка не использует слова «больше», «качество», «оптимизация», «процессы», «эффективность» без цифры рядом?
  • Тон — как у консультанта после первого аудита, не как у маркетингового лендинга?
Если хотя бы одна проверка fail — перепиши.`
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
