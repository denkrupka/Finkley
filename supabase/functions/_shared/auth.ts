/**
 * Хелпер: получить текущего юзера из JWT в Authorization header.
 * Используется в edge functions, которые требуют верификации юзера
 * (verify-jwt: true в supabase.toml — но мы делаем явную проверку,
 * чтобы получить user_id и проверить salon membership).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

export async function getUserFromRequest(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ userId: string } | null> {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice('Bearer '.length).trim()
  if (!token) return null

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return { userId: data.user.id }
}

/**
 * Проверяет что юзер состоит в salon_members этого салона. Возвращает роль.
 */
export async function getSalonMembership(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  salonId: string,
): Promise<{ role: string } | null> {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await admin
    .from('salon_members')
    .select('role')
    .eq('user_id', userId)
    .eq('salon_id', salonId)
    .maybeSingle()
  if (error || !data) return null
  return { role: data.role }
}
