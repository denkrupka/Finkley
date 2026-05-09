// Smoke test: вызвать banking-aspsps с user-JWT и распечатать ответ.
// Подписан JWT с использованием Supabase auth.signInWithPassword? Нет —
// проще: используем service-role-key как Authorization (хак для smoke-теста,
// функция всё равно вызовет supabase.auth.getUser, который примет SR-ключ
// как валидный? Не примет. Поэтому — анонимный запрос → 401, ожидаемо.)
//
// Лучше: тестируем функцию через ANON_KEY и проверяем что подпись JWT
// успешно создаётся и Enable Banking отвечает (не 401 от EB).
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const raw = readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const url = env.VITE_SUPABASE_URL
const fnUrl = url.replace(/\/$/, '') + '/functions/v1'

// Используем SUPABASE_SERVICE_ROLE_KEY — supabase.auth.getUser его НЕ примет
// (это ключ к управлению, не пользовательская сессия). Поэтому ожидаем 401.
const res = await fetch(`${fnUrl}/banking-aspsps?country=PL`, {
  headers: {
    apikey: env.VITE_SUPABASE_ANON_KEY,
    authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
  },
})
console.log('status:', res.status)
const text = await res.text()
console.log('body:', text.slice(0, 1000))
