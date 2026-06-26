/**
 * Lookup email + имя владельца салона по разным «якорям»: stripe_customer_id,
 * stripe_subscription_id или salon_id напрямую. Используется в webhook'ах
 * для отправки уведомлений.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

export type OwnerInfo = {
  user_id: string
  email: string
  full_name: string
  salon_id: string
  salon_name: string
  /** profile.locale (ru/pl/en/...). Дефолт 'ru' если профиль ещё не создан. */
  locale: string
}

function admin(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function getOwnerBySalonId(salonId: string): Promise<OwnerInfo | null> {
  const supa = admin()
  // salon.locale — fallback для приглашённых, у кого profile.locale ещё не задан.
  // country_code тоже учитываем как 2-й fallback (PL → pl, по странам Booksy).
  const { data: salon } = await supa
    .from('salons')
    .select('id, name, locale, country_code')
    .eq('id', salonId)
    .maybeSingle()
  if (!salon) return null

  const { data: member } = await supa
    .from('salon_members')
    .select('user_id')
    .eq('salon_id', salonId)
    .eq('role', 'owner')
    .maybeSingle()
  if (!member) return null

  const { data: userRes } = await supa.auth.admin.getUserById(member.user_id)
  const email = userRes?.user?.email ?? ''
  const full_name = (userRes?.user?.user_metadata?.full_name as string | undefined) ?? ''
  if (!email) return null

  const { data: profile } = await supa
    .from('profiles')
    .select('locale')
    .eq('id', member.user_id)
    .maybeSingle()
  const profileLocale = (profile as { locale?: string | null } | null)?.locale
  const salonRow = salon as { locale?: string | null; country_code?: string | null; name: string }
  const locale = pickLocale(profileLocale, salonRow.locale, salonRow.country_code)

  return {
    user_id: member.user_id,
    email,
    full_name,
    salon_id: salon.id,
    salon_name: salonRow.name,
    locale,
  }
}

/**
 * Каскад выбора локали для серверных уведомлений:
 *   1. profile.locale (явный выбор юзера)
 *   2. salon.locale (онбординг салона)
 *   3. country_code → язык (PL → pl, UA → ru как ближайший, etc.)
 *   4. 'ru' default
 *
 * Экспортируется — переиспользуется в callers которые не используют
 * salon-lookup (notify-welcome, send-weekly-digest, daily-notifications etc.).
 */
export function pickLocale(
  profileLocale?: string | null,
  salonLocale?: string | null,
  countryCode?: string | null,
): string {
  if (profileLocale) return profileLocale
  if (salonLocale) return salonLocale
  if (countryCode) {
    const cc = countryCode.toUpperCase()
    if (cc === 'PL') return 'pl'
    if (['GB', 'US', 'IE', 'AU', 'CA', 'NZ'].includes(cc)) return 'en'
    if (['RU', 'UA', 'BY', 'KZ', 'KG', 'UZ', 'MD', 'AM', 'AZ'].includes(cc)) return 'ru'
  }
  return 'ru'
}

export async function getOwnerByStripeCustomer(customerId: string): Promise<OwnerInfo | null> {
  const supa = admin()
  const { data: sub } = await supa
    .from('salon_subscriptions')
    .select('salon_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (!sub?.salon_id) return null
  return getOwnerBySalonId(sub.salon_id)
}

export async function getOwnerBySubscriptionId(subId: string): Promise<OwnerInfo | null> {
  const supa = admin()
  const { data: sub } = await supa
    .from('salon_subscriptions')
    .select('salon_id')
    .eq('stripe_subscription_id', subId)
    .maybeSingle()
  if (!sub?.salon_id) return null
  return getOwnerBySalonId(sub.salon_id)
}
