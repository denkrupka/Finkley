/**
 * notify-welcome — отправляет приветственное письмо после онбординга.
 *
 * Клиент вызывает с user JWT после успешного RPC create_salon_with_setup.
 * Функция:
 * - Авторизует юзера (verify-jwt: true платформа Supabase)
 * - Извлекает email + имя из JWT (можно слать только себе)
 * - Получает имя салона из БД (опц., передаётся в body)
 * - Вызывает send-email server-to-server со всеми переменными welcome-шаблона
 *
 * Отвечает 200/ok даже если email не отправился — onboarding не должен
 * валиться из-за email infra.
 */

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { renderLogoBlock, sendEmail } from '../_shared/notify.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_ROLE)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  // Получаем email + full_name через admin.getUserById (юзер может слать только себе)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userRes } = await admin.auth.admin.getUserById(user.userId)
  const email = userRes?.user?.email
  if (!email) return jsonResponse({ error: 'no_email' }, 400)
  const fullName = (userRes?.user?.user_metadata?.full_name as string | undefined) ?? ''

  // body опц.: { salon_id, salon_name }
  let salonId: string | null = null
  let salonName = ''
  try {
    const body = await req.json()
    salonId = body.salon_id ?? null
    salonName = body.salon_name ?? ''
  } catch {
    // body не обязательный
  }

  // Если salon_id пришёл — проверяем что юзер реально owner этого салона
  // (anti-abuse: чтобы нельзя было передать чужой salon_name в тело письма).
  let logoUrl = ''
  if (salonId) {
    const { data: member } = await admin
      .from('salon_members')
      .select('role')
      .eq('salon_id', salonId)
      .eq('user_id', user.userId)
      .maybeSingle()
    if (!member || member.role !== 'owner') {
      salonId = null
      salonName = ''
    } else {
      const { data: salon } = await admin
        .from('salons')
        .select('name, logo_url')
        .eq('id', salonId)
        .maybeSingle()
      if (!salonName) salonName = salon?.name ?? ''
      logoUrl = salon?.logo_url ?? ''
    }
  }

  await sendEmail('welcome', email, {
    full_name: fullName || (email.split('@')[0] ?? ''),
    salon_name: salonName,
    logo_block: renderLogoBlock(logoUrl),
    app_url: salonId ? `${APP_URL}${salonId}/dashboard` : APP_URL,
    owner_name: 'команда Finkley',
  })

  return jsonResponse({ ok: true })
})
