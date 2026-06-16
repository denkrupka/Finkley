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
  /** Валюта салона (ISO 4217, напр. 'PLN'). Передаётся с фронта — он всегда
   *  знает её из COUNTRY_OPTIONS по выбранной стране. Edge function использует
   *  её для ВСЕХ сумм и как жёсткий якорь в промпте, чтобы AI не съезжал в EUR.
   *  Фолбэк — по country_code из БД. */
  currency?: string
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
  /** Тип сотрудника: 'master' принимает клиентов, остальные (admin/manager/
   *  reception/other) — нет. Для AI используем ТОЛЬКО мастеров. */
  job_role: string
}

/** Полный маппинг страна → валюта (зеркало COUNTRY_OPTIONS на фронте).
 *  Нужен как фолбэк, если currency не пришла в payload. */
function currencyForCountry(code: string | null | undefined): string | null {
  switch ((code ?? '').toUpperCase()) {
    case 'PL':
      return 'PLN'
    case 'CZ':
      return 'CZK'
    case 'HU':
      return 'HUF'
    case 'RO':
      return 'RON'
    case 'BG':
      return 'BGN'
    case 'UA':
      return 'UAH'
    case 'DE':
    case 'SK':
    case 'AT':
    case 'LT':
    case 'LV':
    case 'EE':
      return 'EUR'
    default:
      return null
  }
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
  currency = 'PLN',
): string {
  const langInstruction = {
    ru: 'Отвечай по-русски. Говори от первого лица консультанта, на «ты», коротко и тепло — как понимающий человек, а не бизнес-аналитик.',
    pl: 'Odpowiadaj po polsku. Mów od pierwszej osoby konsultanta, na «ty», zwięźle i ciepło — jak rozumiejący człowiek, nie analityk biznesowy.',
    en: 'Reply in English. Speak in first person as a consultant, address the owner as "you", short and warm — like a person who gets it, not a business analyst.',
  }[locale]

  const cur = currency || 'PLN'

  // Главная идея — AI звучит как понимающий человек, который посмотрел цифры
  // салона и говорит о них ПРОСТЫМИ словами и конкретными именами/суммами.
  // Никакого жаргона (retention/RFM/payout/PLN-час) и никаких пустых советов.
  const groundingRules = `
=== ВАЛЮТА (ЖЁСТКОЕ ПРАВИЛО) ===
Валюта этого салона — ${cur}. ВСЕ суммы пиши только в ${cur}. Если где-то в примерах ниже встречается "PLN" — это просто образец формата, ты ОБЯЗАН использовать ${cur}. Никогда не пиши EUR / € / евро, если валюта салона не EUR.

=== КТО ТЫ ===
Ты человек, который помог сотням маленьких салонов навести порядок в деньгах. Говоришь с владелицей салона как понимающий друг, который сам всё это прошёл. Она НЕ знает и НЕ должна знать слова «retention», «RFM», «churn», «payout», «utilization», «AOV», «маржинальность» — это не её язык. Объясняй всё простыми словами, через конкретные имена и суммы.

=== ОПИРАЙСЯ ТОЛЬКО НА ФАКТЫ (нарушение = ответ выбрасывается) ===
1. Используй ТОЛЬКО реальные данные из блока "REAL DATA" (мастера, услуги, визиты за 30/60/90 дней, топ-мастера, топ-услуги, отзывы). Не выдумывай ни цифр, ни имён.
2. Называй реальные имена мастеров и услуг из списков. Хотя бы одно имя в каждой карточке (исключение — тема «отзывы», см. ниже).
3. Все суммы — конкретными числами в ${cur}: «5 услуг», «3 мастера», «47 визитов за месяц», «средний чек 165 ${cur}».
4. Если чего-то реально 0 — честно скажи и дай ОДИН понятный следующий шаг. Не делай вид, что данные есть.
5. В списке мастеров (STAFF LIST) — ТОЛЬКО мастера, которые принимают клиентов. Администраторов, ресепшен и менеджеров там нет. Никогда не пиши про «сотрудника без визитов» — таких в данных не будет.

=== БЕЗ ЗАУМИ (за эти слова ответ переписывается) ===
Запрещены термины: retention, RFM, churn, payout, utilization, AOV, «маржинальность», «оптимизация», «эффективность». Вместо них — по-человечески:
- вместо «retention 78%» → «из 10 клиентов 8 приходят снова»
- вместо «payout 40%» → «забирает себе 40% от стоимости услуги»
- вместо «churn / отток» → «перестали приходить»
- вместо «загрузка кресла 78%» → «рабочий день занят почти полностью»
- «средний чек», «цена», «выручка», «прибыль», «доход» — нормальные слова, их можно.
Запрещены и пустые советы без цифр: «добавьте услуг», «привлекайте клиентов», «работайте над качеством», «повышайте эффективность».

=== КАК ГОВОРИТЬ (плохо → хорошо) ===
ПЛОХО: «Рекомендую поднять цены на маржинальные услуги»
ХОРОШО: «Женская стрижка у тебя 120 ${cur} и занимает час. Подними до 140 — за месяц это примерно +800 ${cur}, а уйдёт максимум один-два человека из двадцати»

ПЛОХО: «У вас сильная команда, высокий retention»
ХОРОШО: «Больше всего приносит Анна — 3 840 ${cur} за месяц, и к ней почти все возвращаются. А Виктория при той же ставке принесла втрое меньше — стоит спокойно разобраться почему»

ПЛОХО: «Отзывы важны для роста»
ХОРОШО: «У тебя 47 отзывов, в среднем 4.7 — это хорошо. Но в девяти жалуются, что долго ждали на ресепшене. Это не про мастеров — это про встречу гостя»`

  if (mode === 'breakdown') {
    const topicHint =
      topic === 'services'
        ? `Разбор по услугам. Используй SERVICES CATALOG (имя, цена, длительность) + TOP SERVICES BY REVENUE.
Прикинь, сколько услуга приносит за час работы (цена ÷ длительность × 60).
Что показать:
  • какие 1-2 услуги выгоднее всего по деньгам за час (с именами и суммой в ${cur}),
  • услуга, которая занимает много времени, но стоит мало (назови её и предложи, что сделать),
  • где можно спокойно поднять цену (с конкретной цифрой "со 120 → 140 ${cur}"),
  • какие 2 реальные услуги из каталога предложить вместе одной ценой ("X + Y за 350 ${cur}").
Если визитов за 30 дней нет — так и скажи: "когда наберётся первых 30 визитов, покажу, какая из X, Y, Z приносит больше; пока вижу, что Z дороже всех (320 ${cur} / 90 мин) — на неё посмотрю первой".`
        : topic === 'staff'
          ? `Разбор по мастерам. Используй STAFF LIST (имена) + TOP STAFF BY REVENUE (визиты/выручка/как часто клиенты возвращаются).
В STAFF LIST только мастера — администраторов и ресепшен там нет, про них не пиши.
Что показать:
  • кто принёс больше всех за месяц — с именем и суммой ("Анна — 3 840 ${cur}, 12 визитов"),
  • кто заметно отстаёт при той же ставке — имя + спокойный понятный шаг (поставить рядом с сильным мастером / посмотреть график),
  • к кому клиенты возвращаются чаще ("к Лесе из 10 клиентов снова приходят 8"),
  • кому доверить самую выгодную услугу из каталога (свяжи 1 имя мастера + 1 название услуги).
Если визитов с привязкой к мастеру ещё нет, но мастера есть — назови 2-3 имени из STAFF LIST и скажи: "после первых визитов покажу, кто из них приносит больше".`
          : topic === 'clients'
            ? `Разбор по клиентам. Используй число клиентов + визиты за 30/60/90 дней + топ-мастеров.
Говори простыми словами: постоянные, новенькие, те, кто давно не заходил.
Что показать:
  • сколько у тебя постоянных клиентов (тех, кто ходит регулярно) — с числом,
  • сколько новеньких пришло за месяц и сколько из них вернулось ("из 12 новых вернулись только 4"),
  • к какому мастеру (по имени) клиенты возвращаются чаще — туда лучше направлять новеньких,
  • простой способ вернуть тех, кто давно не был ("сообщение через 5 недель: 'мы соскучились, −15% на следующий визит'").
Если клиентов в системе ещё нет — скажи: "как только подтянутся визиты из Booksy, я разложу твою базу на постоянных, новеньких и тех, кто давно не был, и подскажу, кому что написать".`
            : `Разбор по отзывам. Тема строго про ОТЗЫВЫ — не уходи в мастеров и услуги.
Сначала посмотри на "Connected integrations" и число отзывов (reviews) в REAL DATA:
  • Если отзывы есть — разбери их: средняя оценка простыми словами ("4.7 — это хорошо"), за что чаще хвалят, на что жалуются даже в хороших отзывах, и предложи авто-просьбу об отзыве после визита (хорошие → в Google, средние → лично тебе).
  • Если отзывов 0, НО среди Connected integrations есть booksy / google / instagram / facebook — значит отзывы ещё подгружаются. Так и напиши спокойно: "отзывы ещё подтягиваются из Booksy, синхронизация идёт — загляни сюда чуть позже, и я разберу, что пишут твои гости". НЕ пиши "у тебя 0 отзывов" и НЕ зови подключать то, что уже подключено.
  • Если отзывов 0 и ни один источник отзывов не подключён — мягко предложи подключить Booksy или Google, чтобы начать собирать и разбирать отзывы автоматически.
Имена мастеров в этой теме называть НЕ обязательно — карточки про отзывы.`
    return `=== КОНТЕКСТ ===
Ты на онбординге Finkley, шаг «Разбор: ${topic}». Владелец только что подключил интеграции и хочет увидеть, что ты уже понимаешь про его салон. Это его первый wow-момент.

${langInstruction}

${groundingRules}

=== ФОКУС ТЕМЫ ===
${topicHint}

=== ФОРМАТ ОТВЕТА — СТРОГО JSON ===
{
  "insights": [
    {
      "title": "<до 60 символов, по-человечески>",
      "body": "<1-2 предложения с конкретными числами/именами из real_data, простыми словами>",
      "chip": "<опциональный короткий бейдж, напр. '+800 ${cur}/мес', 'возвращаются 8 из 10'>"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Ровно 4 карточки — не 3 и не 5.
Каждая карточка опирается на реальные данные: имя мастера/услуги ИЛИ конкретное число. Исключение — тема «отзывы» без данных: тогда 4 карточки честно объясняют, что появится, когда отзывы подгрузятся, без выдуманных цифр.`
  }
  if (mode === 'full_summary') {
    return `=== КОНТЕКСТ ===
Ты на финальном шаге онбординга Finkley. Владелец прошёл весь визард. Это твой первый разбор «по горячим следам» — он должен закрыть онбординг с ощущением «этот помощник уже понимает мой салон».

${langInstruction}

${groundingRules}

=== ЗАДАЧА ===
На основе REAL DATA выдай:
1. overview — 2-4 предложения простыми словами, как будто ты только что посмотрел цифры салона. Обязательно: название салона, чем занимается, сколько мастеров и услуг, минимум одно имя мастера или услуги, и главный вывод (что хорошо + одна вещь, которую стоит подтянуть).
2. advice — 4-6 конкретных советов с приоритетом. Каждый совет = понятное действие с цифрой и/или именем. Без терминов.

Приоритет:
  • "high" = сделать на этой неделе, прямо влияет на деньги (поднять цену / убрать невыгодную услугу / помочь отстающему мастеру),
  • "medium" = в течение месяца (предложить услуги вместе / настроить напоминания клиентам),
  • "low" = на потом, вдолгую.

=== ФОРМАТ ОТВЕТА — СТРОГО JSON ===
{
  "overview": "<2-4 предложения с именами и цифрами, простыми словами; никакого «у вас прекрасный салон»>",
  "advice": [
    {
      "title": "<до 60 символов, конкретное действие, по возможности с именем>",
      "body": "<1-2 предложения: ЧТО сделать, ПОЧЕМУ это видно из цифр, что это даст>",
      "priority": "high" | "medium" | "low"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Сортируй advice по приоритету (high первыми).
Каждый совет содержит: (1) конкретное имя мастера/услуги ИЛИ число из real_data, (2) что это даст (в ${cur}, в клиентах или во времени).`
  }
  return `=== КОНТЕКСТ ===
Ты на WOW-шаге онбординга Finkley. Владелец только что подключил интеграции / добавил мастеров и услуги. Это первый момент, когда помощник показывает «что я уже вижу». Цель — чтобы владелец сказал «как я раньше без этого работала».

${langInstruction}

${groundingRules}

=== ЗАДАЧА ===
Сгенерируй 4 карточки. Каждая — одна конкретная вещь, которую ты уже видишь в данных салона, или которую раскроешь после первых визитов.

Набор карточек:
  • 1 — про конкретного мастера или услугу из каталога (с именем),
  • 1 — про интеграции (что подключено и что это даёт простыми словами),
  • 1 — про ближайший шаг владельца (с конкретной цифрой),
  • 1 — про то, что будет видно через 30 дней визитов.

Если в салоне пока нет ни визитов, ни отзывов:
  • не пиши «нет данных» в каждой карточке — это скучно,
  • опирайся на каталог: имена мастеров, цены и длительность услуг → делай аккуратные выводы,
  • пример хорошей карточки: «Самая дорогая у тебя услуга — окрашивание, 320 ${cur}. Жду первых визитов, но уже похоже, что она и принесёт большую часть выручки».

=== ФОРМАТ ОТВЕТА — СТРОГО JSON ===
{
  "insights": [
    {
      "icon": "staff" | "services" | "bookings" | "banking" | "social" | "google" | "company" | "general",
      "title": "<до 60 символов, с именем мастера/услуги или конкретной цифрой>",
      "body": "<1-2 предложения с числами и минимум 1 именем из real_data, простыми словами>"
    }
  ]
}

JSON only, no markdown, no preface, no code fences. Ровно 4 карточки.
Иконки по смыслу: staff — мастера, services — услуги, bookings — Booksy/календарь, banking — банк, social — IG/FB/Telegram, google — Google, company — компания/NIP.`
}

function buildPrompt(
  payload: OnboardingPayload,
  real: SalonRealData | null,
  currency = 'PLN',
): string {
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
${realDataDigest(real, currency)}
=== END REAL DATA ===`
    : `

=== SALON STATE: ${salonState} ===
${stateHints[salonState]}`
  return `=== ВАЛЮТА САЛОНА: ${currency} (все суммы — только в ${currency}) ===

=== OWNER'S ONBOARDING INPUT (что юзер ввёл в визарде) ===
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
    // Тащим job_role; если колонка ещё не мигрирована (deploy раньше миграции) —
    // PostgREST вернёт не-массив, тогда повторяем без job_role и считаем всех
    // мастерами. Возвращаем ТОЛЬКО мастеров — админ/ресепшен/менеджер для AI
    // не нужны (задача 9: «не писать про сотрудников без визитов»).
    type Raw = {
      id: string
      full_name: string
      payout_percent: number | string | null
      payout_scheme: string | null
      is_active: boolean
      job_role?: string | null
    }
    const tryFetch = async (withRole: boolean): Promise<Raw[] | null> => {
      const cols = `id,full_name,payout_percent,payout_scheme,is_active${withRole ? ',job_role' : ''}`
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/staff?select=${cols}&salon_id=eq.${salonId}&deleted_at=is.null&order=is_active.desc,full_name.asc&limit=50`,
        { headers },
      )
      const data = await res.json()
      return Array.isArray(data) ? (data as Raw[]) : null
    }
    let rows = await tryFetch(true)
    if (rows === null) rows = await tryFetch(false)
    if (rows === null) return []
    return rows
      .map((r) => ({
        id: r.id,
        name: r.full_name,
        payout_percent: r.payout_percent != null ? Number(r.payout_percent) : null,
        payout_scheme: r.payout_scheme,
        is_active: !!r.is_active,
        // null/undefined трактуем как мастера (дефолт колонки + старые строки).
        job_role: r.job_role ?? 'master',
      }))
      .filter((s) => s.job_role === 'master')
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
    _staff_total_all,
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
    // staff_total для AI = число мастеров (список staff уже отфильтрован по
    // job_role='master'). Админов/ресепшен в счёт не берём — задача 9.
    staff_total: staff.length,
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
function realDataDigest(real: SalonRealData, currency = 'PLN'): string {
  const cur = currency || 'PLN'
  const fmtMoney = (cents: number) => `${Math.round(cents / 100)} ${cur}`
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

  // Валюта: сначала явная из payload (фронт знает её из COUNTRY_OPTIONS),
  // затем по country_code салона из БД, затем по country из payload, иначе PLN.
  const currency =
    (typeof payload.currency === 'string' && payload.currency.trim()) ||
    currencyForCountry(real?.salon.country_code) ||
    currencyForCountry(payload.country) ||
    'PLN'

  try {
    const result = await claudeJson(
      systemForLocale(locale, mode, payload.topic, currency),
      buildPrompt(payload, real, currency),
    )
    return json(result)
  } catch (e) {
    return json({ error: 'ai_failed', detail: e instanceof Error ? e.message : String(e) }, 502)
  }
})
