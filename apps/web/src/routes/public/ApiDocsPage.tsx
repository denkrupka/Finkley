import { Code2, Copy, ExternalLink, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { LogoLockup } from '@/components/ui/logo'

/**
 * Публичная страница документации API: GET /docs/api.
 *
 * Доступна БЕЗ авторизации (роут зарегистрирован вне RequireAuth в App.tsx).
 *
 * Ключевая идея против «дрейфа документации»: список ресурсов и их полей
 * подтягивается ВЖИВУЮ из discovery-эндпоинта public-api (GET /v1), который
 * генерируется из того же реестра, что и сам API. Поэтому документация всегда
 * соответствует фактическому поведению. Статический fallback — на случай, если
 * API недоступен (offline / не задеплоен).
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const API_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/public-api`
  : '/functions/v1/public-api'

type CatalogResource = {
  resource: string
  kind: 'table' | 'rpc'
  path: string
  methods: string[]
  description: string
  readable_fields: string[]
  writable_fields_create: string[]
  writable_fields_update: string[]
  required_on_create: string[]
  filters: string[]
  date_range: string[]
  money_fields: string[]
  rpc_params: { name: string; required: boolean }[]
  parent_filter: string | null
}

type Catalog = {
  version: string
  money_note: string
  auth: string
  scopes: string[]
  pagination: { default_limit: number; max_limit: number; params: string[] }
  resources: CatalogResource[]
}

function CodeBlock({ code, copyLabel }: { code: string; copyLabel: string }) {
  return (
    <div className="relative">
      <pre className="border-border bg-brand-navy num overflow-x-auto rounded-lg border p-4 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(code)
          toast.success(copyLabel)
        }}
        className="bg-card/90 text-foreground hover:bg-card absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] font-semibold shadow-sm"
      >
        <Copy className="size-3" strokeWidth={1.8} />
        Copy
      </button>
    </div>
  )
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700',
  POST: 'bg-sky-100 text-sky-700',
  PATCH: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
}

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`num rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
        METHOD_COLORS[method] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {method}
    </span>
  )
}

function FieldChips({ title, fields }: { title: string; fields: string[] }) {
  if (!fields.length) return null
  return (
    <div className="mt-2">
      <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
        {title}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {fields.map((f) => (
          <span
            key={f}
            className="border-border bg-muted/40 num rounded border px-1.5 py-0.5 text-[11px]"
          >
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

function ResourceCard({ r }: { r: CatalogResource }) {
  const { t } = useTranslation()
  return (
    <details className="border-border bg-card group rounded-lg border p-4">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="flex gap-1">
          {r.methods.map((m) => (
            <MethodBadge key={m} method={m} />
          ))}
        </span>
        <code className="text-brand-navy num text-sm font-bold">{r.path}</code>
        <span className="text-muted-foreground ml-auto text-[11px]">
          {r.kind === 'rpc' ? 'analytics' : r.parent_filter ? `?${r.parent_filter}=…` : ''}
        </span>
      </summary>
      <p className="text-foreground/80 mt-3 text-sm">{r.description}</p>

      {r.rpc_params.length > 0 && (
        <FieldChips
          title={t('docs_api.fields_params', { defaultValue: 'Параметры' })}
          fields={r.rpc_params.map((p) => (p.required ? `${p.name}*` : p.name))}
        />
      )}
      {r.required_on_create.length > 0 && (
        <FieldChips
          title={t('docs_api.fields_required', { defaultValue: 'Обязательны при создании' })}
          fields={r.required_on_create}
        />
      )}
      {r.writable_fields_create.length > 0 && (
        <FieldChips
          title={t('docs_api.fields_create', { defaultValue: 'Можно задать при создании' })}
          fields={r.writable_fields_create}
        />
      )}
      {r.writable_fields_update.length > 0 && (
        <FieldChips
          title={t('docs_api.fields_update', { defaultValue: 'Можно изменить' })}
          fields={r.writable_fields_update}
        />
      )}
      {r.filters.length > 0 && (
        <FieldChips
          title={t('docs_api.fields_filters', { defaultValue: 'Фильтры (?поле=значение)' })}
          fields={r.filters}
        />
      )}
      {r.date_range.length > 0 && (
        <FieldChips
          title={t('docs_api.fields_daterange', { defaultValue: 'Диапазон дат' })}
          fields={r.date_range}
        />
      )}
      <FieldChips
        title={t('docs_api.fields_read', { defaultValue: 'Поля в ответе' })}
        fields={r.readable_fields}
      />
      {r.money_fields.length > 0 && (
        <FieldChips
          title={t('docs_api.fields_money', { defaultValue: 'Суммы (в копейках)' })}
          fields={r.money_fields}
        />
      )}
    </details>
  )
}

export function ApiDocsPage() {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    // discovery (/v1) публичен (verify_jwt=false) — шлём ПРОСТОЙ GET без
    // кастомных заголовков, чтобы не триггерить CORS-preflight (иначе браузер
    // блокировал бы запрос на заголовке apikey).
    fetch(`${API_BASE}/v1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Catalog) => {
        if (!alive) return
        setCatalog(data)
        setState('ok')
      })
      .catch(() => {
        if (alive) setState('error')
      })
    return () => {
      alive = false
    }
  }, [])

  const grouped = useMemo(() => {
    const tables = catalog?.resources.filter((r) => r.kind === 'table') ?? []
    const rpcs = catalog?.resources.filter((r) => r.kind === 'rpc') ?? []
    return { tables, rpcs }
  }, [catalog])

  const exampleList = `curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/visits?from=2026-06-01&to=2026-06-30&limit=20"`

  const exampleCreate = `curl -X POST "${API_BASE}/v1/expenses" \\
  -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{
    "expense_at": "2026-06-15",
    "amount_cents": 15000,
    "category_id": "<uuid категории>",
    "description": "Шампунь оптом"
  }'`

  const examplePatch = `curl -X PATCH "${API_BASE}/v1/clients/<uuid>" \\
  -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{ "discount_percent": 10 }'`

  const exampleDelete = `curl -X DELETE "${API_BASE}/v1/visits/<uuid>" \\
  -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ"`

  const exampleKpis = `curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/dashboard-kpis?from=2026-06-01&to=2026-06-30"`

  const exampleJs = `const res = await fetch(
  "${API_BASE}/v1/clients?limit=50",
  { headers: { Authorization: "Bearer fnk_live_ВАШ_КЛЮЧ" } }
)
const { data, pagination } = await res.json()
console.log(data, pagination)`

  // ── Рецепты под частые вопросы ──
  const recipeCreateVisit = `# 1) узнать id мастера/услуги (если нужны): GET /v1/staff, GET /v1/services
# 2) создать визит (amount_cents — в копейках: 15000 = 150,00)
curl -X POST "${API_BASE}/v1/visits" \\
  -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{
    "visit_at": "2026-06-15T12:30:00Z",
    "amount_cents": 15000,
    "staff_id": "<uuid мастера>",
    "client_id": "<uuid клиента>",
    "service_id": "<uuid услуги>",
    "payment_method": "card"
  }'`

  const recipeServices = `# Список услуг с ценами (default_price_cents) и себестоимостью (cost_cents)
curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/services?limit=200"
# каждая услуга: { id, name, category_id, default_price_cents, cost_cents, default_duration_min, ... }
# категории услуг:
curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" "${API_BASE}/v1/service-categories"`

  const recipeStaff = `# Список мастеров
curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/staff?is_active=true"`

  const recipeStaffServices = `# Услуги, которые выполняет конкретный мастер (обязателен ?staff_id=)
curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/staff-services?staff_id=<uuid мастера>"
# вернёт строки { staff_id, service_id } — соедини с GET /v1/services по service_id`

  const recipePhotos = `# Фото мастеров — поле avatar_url в /v1/staff
curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/staff?is_active=true"
# у каждого мастера: { id, full_name, avatar_url, ... }`

  const recipeReviews = `# Отзывы с Google / Booksy (их подтягивает наш портал) + internal
curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/reviews?source=google"      # или source=booksy / internal
# поля: rating (1-5), body, author_name, posted_at, external_url, reply_text`

  const recipeRating = `# Агрегатный рейтинг салона (Google / Booksy)
curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\
  "${API_BASE}/v1/salon-metrics?kind=rating"
# snapshot по source: data = { rating: 4.9, count: 213 }`

  const copyLabel = t('docs_api.copied', { defaultValue: 'Скопировано' })

  return (
    <div className="bg-background min-h-screen">
      <header className="border-border bg-card border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label="home">
            <LogoLockup size={24} />
          </Link>
          <a
            href="mailto:info@finkley.app"
            className="text-secondary inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            <ExternalLink className="size-4" strokeWidth={1.7} />
            info@finkley.app
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8 flex items-center gap-3">
          <span
            className="bg-brand-teal-soft text-brand-teal-deep grid size-12 place-items-center rounded-xl"
            aria-hidden
          >
            <Code2 className="size-6" strokeWidth={1.8} />
          </span>
          <div>
            <h1 className="text-brand-navy text-3xl font-bold tracking-tight">
              {t('docs_api.title', { defaultValue: 'API Finkley' })}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('docs_api.subtitle', {
                defaultValue:
                  'REST API для собственных интеграций салона: Zapier, n8n, Make, скрипты. Стабильная версия — v1.',
              })}
            </p>
          </div>
        </div>

        {/* Быстрый старт */}
        <Section
          icon={<KeyRound className="size-4" strokeWidth={1.8} />}
          title={t('docs_api.quickstart', { defaultValue: 'Быстрый старт' })}
        >
          <ol className="text-foreground/80 list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              {t('docs_api.qs1', { defaultValue: 'Создайте ключ в приложении:' })}{' '}
              <Link to="/" className="text-primary font-semibold hover:underline">
                {t('docs_api.qs1_link', { defaultValue: 'Настройки → API → Создать ключ' })}
              </Link>
              .{' '}
              {t('docs_api.qs1_note', {
                defaultValue: 'Ключ показывается один раз — сохраните его.',
              })}
            </li>
            <li>
              {t('docs_api.qs2', {
                defaultValue: 'Передавайте ключ в заголовке Authorization: Bearer …',
              })}
            </li>
            <li>
              {t('docs_api.qs3', {
                defaultValue: 'Проверьте ключ запросом /v1/me — вернёт ваш салон и права.',
              })}
            </li>
          </ol>
          <div className="mt-4">
            <CodeBlock
              code={`curl -H "Authorization: Bearer fnk_live_ВАШ_КЛЮЧ" \\\n  "${API_BASE}/v1/me"`}
              copyLabel={copyLabel}
            />
          </div>
        </Section>

        {/* База и аутентификация */}
        <Section title={t('docs_api.base_auth', { defaultValue: 'Базовый URL и аутентификация' })}>
          <dl className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <dt className="text-muted-foreground text-sm font-semibold">
              {t('docs_api.base_url', { defaultValue: 'Базовый URL' })}
            </dt>
            <dd className="num text-foreground break-all text-sm">{API_BASE}</dd>
            <dt className="text-muted-foreground text-sm font-semibold">
              {t('docs_api.auth_h', { defaultValue: 'Аутентификация' })}
            </dt>
            <dd className="text-foreground text-sm">
              <code className="num">Authorization: Bearer fnk_live_…</code>{' '}
              {t('docs_api.auth_or', { defaultValue: 'или' })}{' '}
              <code className="num">x-api-key: fnk_live_…</code>
            </dd>
            <dt className="text-muted-foreground text-sm font-semibold">
              {t('docs_api.scopes_h', { defaultValue: 'Права (scopes)' })}
            </dt>
            <dd className="text-foreground text-sm">
              <code className="num">read</code> —{' '}
              {t('docs_api.scope_read', { defaultValue: 'чтение (GET)' })};{' '}
              <code className="num">write</code> —{' '}
              {t('docs_api.scope_write', { defaultValue: 'запись (POST/PATCH/DELETE)' })}.{' '}
              {t('docs_api.scope_403', { defaultValue: 'Без нужного права — 403.' })}
            </dd>
          </dl>
        </Section>

        {/* Соглашения */}
        <Section
          icon={<ShieldCheck className="size-4" strokeWidth={1.8} />}
          title={t('docs_api.conventions', { defaultValue: 'Соглашения' })}
        >
          <ul className="text-foreground/80 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>{t('docs_api.conv_money_t', { defaultValue: 'Деньги' })}:</strong>{' '}
              {t('docs_api.conv_money', {
                defaultValue:
                  'все суммы (поля *_cents) — целые числа в копейках/центах. 15000 = 150,00.',
              })}
            </li>
            <li>
              <strong>{t('docs_api.conv_time_t', { defaultValue: 'Время' })}:</strong>{' '}
              {t('docs_api.conv_time', {
                defaultValue:
                  'даты в ISO 8601 (UTC). Например 2026-06-15 или 2026-06-15T10:30:00Z.',
              })}
            </li>
            <li>
              <strong>{t('docs_api.conv_scope_t', { defaultValue: 'Изоляция' })}:</strong>{' '}
              {t('docs_api.conv_scope', {
                defaultValue:
                  'ключ привязан к одному салону. Вы видите и меняете только его данные.',
              })}
            </li>
            <li>
              <strong>{t('docs_api.conv_page_t', { defaultValue: 'Пагинация' })}:</strong>{' '}
              {t('docs_api.conv_page', {
                defaultValue:
                  'параметры limit (по умолчанию 50, максимум 200) и offset. Ответ: { data, pagination }.',
              })}
            </li>
            <li>
              <strong>
                {t('docs_api.conv_filter_t', { defaultValue: 'Фильтры и сортировка' })}:
              </strong>{' '}
              {t('docs_api.conv_filter', {
                defaultValue:
                  '?поле=значение (см. ресурс), диапазон ?from=&to=, сортировка ?order=поле&dir=asc|desc.',
              })}
            </li>
          </ul>
        </Section>

        {/* Рецепты — частые задачи */}
        <Section title={t('docs_api.recipes', { defaultValue: 'Рецепты — частые задачи' })}>
          <div className="space-y-4">
            <Example
              title={t('docs_api.rc_create_visit', { defaultValue: 'Как создать визит' })}
              code={recipeCreateVisit}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.rc_services', { defaultValue: 'Как вытянуть услуги и цены' })}
              code={recipeServices}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.rc_staff', { defaultValue: 'Как вытянуть список мастеров' })}
              code={recipeStaff}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.rc_staff_services', {
                defaultValue: 'Какие услуги выполняет мастер',
              })}
              code={recipeStaffServices}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.rc_photos', { defaultValue: 'Фото мастеров' })}
              code={recipePhotos}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.rc_reviews', { defaultValue: 'Отзывы с Google / Booksy' })}
              code={recipeReviews}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.rc_rating', { defaultValue: 'Рейтинг салона (Google / Booksy)' })}
              code={recipeRating}
              copyLabel={copyLabel}
            />
          </div>
        </Section>

        {/* Примеры */}
        <Section title={t('docs_api.examples', { defaultValue: 'Примеры запросов' })}>
          <div className="space-y-4">
            <Example
              title={t('docs_api.ex_list', { defaultValue: 'Список визитов за период' })}
              code={exampleList}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.ex_create', { defaultValue: 'Создать расход' })}
              code={exampleCreate}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.ex_patch', { defaultValue: 'Изменить клиента' })}
              code={examplePatch}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.ex_delete', { defaultValue: 'Удалить визит' })}
              code={exampleDelete}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.ex_kpis', { defaultValue: 'Сводка KPI (аналитика)' })}
              code={exampleKpis}
              copyLabel={copyLabel}
            />
            <Example
              title={t('docs_api.ex_js', { defaultValue: 'JavaScript (fetch)' })}
              code={exampleJs}
              copyLabel={copyLabel}
            />
          </div>
        </Section>

        {/* Ошибки */}
        <Section title={t('docs_api.errors', { defaultValue: 'Ошибки' })}>
          <p className="text-foreground/80 mb-3 text-sm">
            {t('docs_api.errors_intro', {
              defaultValue:
                'Ошибки приходят в формате { "error": { "code", "message" } } со статусом HTTP:',
            })}
          </p>
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">HTTP</th>
                  <th className="px-3 py-2 font-semibold">code</th>
                  <th className="px-3 py-2 font-semibold">
                    {t('docs_api.errors_when', { defaultValue: 'Когда' })}
                  </th>
                </tr>
              </thead>
              <tbody className="text-foreground/80">
                {[
                  [
                    '401',
                    'unauthorized / invalid_key',
                    t('docs_api.err_401', { defaultValue: 'нет ключа, ключ неверный или отозван' }),
                  ],
                  [
                    '403',
                    'forbidden',
                    t('docs_api.err_403', {
                      defaultValue: 'у ключа нет нужного права (read/write)',
                    }),
                  ],
                  [
                    '404',
                    'not_found',
                    t('docs_api.err_404', {
                      defaultValue: 'ресурс/запись не найдены в вашем салоне',
                    }),
                  ],
                  [
                    '400',
                    'invalid_request',
                    t('docs_api.err_400', {
                      defaultValue: 'некорректное тело, параметры или суммы не целые',
                    }),
                  ],
                  [
                    '405',
                    'method_not_allowed',
                    t('docs_api.err_405', {
                      defaultValue: 'метод недоступен для ресурса (например, запись в read-only)',
                    }),
                  ],
                  [
                    '500',
                    'internal',
                    t('docs_api.err_500', { defaultValue: 'внутренняя ошибка — попробуйте позже' }),
                  ],
                ].map(([code, machine, when]) => (
                  <tr key={code as string} className="border-border border-t">
                    <td className="num px-3 py-2 font-semibold">{code}</td>
                    <td className="num px-3 py-2">{machine}</td>
                    <td className="px-3 py-2">{when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Ресурсы (живой каталог) */}
        <Section title={t('docs_api.resources', { defaultValue: 'Ресурсы' })}>
          {state === 'loading' && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              {t('docs_api.loading', { defaultValue: 'Загружаем актуальный список из API…' })}
            </div>
          )}
          {state === 'error' && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
              {t('docs_api.load_error', {
                defaultValue:
                  'Не удалось загрузить живой каталог из API. Проверьте подключение или попробуйте позже — структура запросов выше остаётся актуальной.',
              })}
            </div>
          )}
          {state === 'ok' && catalog && (
            <>
              <p className="text-muted-foreground mb-4 text-sm">
                {t('docs_api.resources_intro', {
                  defaultValue:
                    'Список ниже загружен из живого API — он всегда соответствует фактическому поведению.',
                })}{' '}
                {t('docs_api.resources_count', {
                  defaultValue: 'Всего ресурсов: {{count}}.',
                  count: catalog.resources.length,
                })}
              </p>

              <h3 className="text-brand-navy mb-2 mt-2 text-sm font-bold uppercase tracking-wider">
                {t('docs_api.group_data', { defaultValue: 'Данные (CRUD / чтение)' })}
              </h3>
              <div className="space-y-2">
                {grouped.tables.map((r) => (
                  <ResourceCard key={r.resource} r={r} />
                ))}
              </div>

              <h3 className="text-brand-navy mb-2 mt-6 text-sm font-bold uppercase tracking-wider">
                {t('docs_api.group_analytics', { defaultValue: 'Аналитика (только чтение)' })}
              </h3>
              <div className="space-y-2">
                {grouped.rpcs.map((r) => (
                  <ResourceCard key={r.resource} r={r} />
                ))}
              </div>
            </>
          )}
        </Section>

        <p className="text-muted-foreground mt-10 text-center text-xs">
          {t('docs_api.footer', { defaultValue: 'Finkley API · v1' })} ·{' '}
          <a href="/privacy" className="hover:underline">
            Privacy
          </a>{' '}
          ·{' '}
          <a href="/terms" className="hover:underline">
            Terms
          </a>
        </p>
      </main>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-border bg-card shadow-finsm mb-6 rounded-xl border p-5 sm:p-6">
      <h2 className="text-brand-navy mb-3 inline-flex items-center gap-2 text-lg font-bold tracking-tight">
        {icon ? <span className="text-secondary">{icon}</span> : null}
        {title}
      </h2>
      {children}
    </section>
  )
}

function Example({ title, code, copyLabel }: { title: string; code: string; copyLabel: string }) {
  return (
    <div>
      <p className="text-foreground mb-1.5 text-sm font-semibold">{title}</p>
      <CodeBlock code={code} copyLabel={copyLabel} />
    </div>
  )
}
