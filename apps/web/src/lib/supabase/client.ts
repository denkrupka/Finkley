import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars. Скопируй apps/web/.env.example в apps/web/.env.local и заполни VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.',
  )
}

/**
 * Singleton Supabase клиент для всего приложения.
 * Использует anon-key — RLS защищает данные.
 *
 * Для admin-операций используй service-role-key только в edge functions,
 * НИКОГДА в клиентском коде.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
