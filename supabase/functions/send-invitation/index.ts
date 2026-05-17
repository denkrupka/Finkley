/**
 * send-invitation — admin/owner салона отправляет email-приглашение в команду.
 *
 * Flow:
 *   1) Admin POSTs {salon_id, email, role, staff_id?}
 *   2) Проверяем что юзер — admin/owner
 *   3) Генерим cryptographically random token (32 байта base64url)
 *   4) Insert в salon_invitations (expires +14 дней)
 *   5) Шлём email с ссылкой /accept-invite?token=...
 *
 * При cancel: action='cancel', invitation_id → ставит cancelled_at.
 * При resend: пересоздаёт token и отправляет письмо.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { renderLogoBlock, sendEmail } from '../_shared/notify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function ensureAdmin(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data && (data.role === 'owner' || data.role === 'admin')
}

async function handleCreate(
  admin: SupabaseClient,
  userId: string,
  body: {
    salon_id?: string
    email?: string
    role?: string
    staff_id?: string | null
    auto_create_staff?: boolean
    invited_first_name?: string
    invited_last_name?: string
    invited_phone?: string
  },
): Promise<Response> {
  if (!body.salon_id || !body.email || !body.role) {
    return jsonResponse({ ok: false, error: 'missing_fields' }, 400)
  }
  const allowedRoles = ['admin', 'accountant', 'staff']
  if (!allowedRoles.includes(body.role)) {
    return jsonResponse({ ok: false, error: 'invalid_role' }, 400)
  }
  if (!(await ensureAdmin(admin, userId, body.salon_id))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  const email = body.email.trim().toLowerCase()
  const token = makeToken()

  // Проверяем что emailя не уже в salon_members
  const { data: existingMember } = await admin
    .from('salon_members')
    .select('user_id, auth_users:auth.users(email)')
    .eq('salon_id', body.salon_id)
  // Простая проверка через auth.admin
  const { data: usersList } = await admin.auth.admin.listUsers()
  const existing = usersList.users?.find((u) => u.email?.toLowerCase() === email)
  if (existing) {
    const isMember = (existingMember ?? []).some(
      (m: { user_id: string }) => m.user_id === existing.id,
    )
    if (isMember) {
      return jsonResponse({ ok: false, error: 'already_member' }, 400)
    }
  }

  // Удаляем старые pending приглашения для того же email
  await admin
    .from('salon_invitations')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('salon_id', body.salon_id)
    .ilike('email', email)
    .is('accepted_at', null)
    .is('cancelled_at', null)

  const { data: inv, error: insErr } = await admin
    .from('salon_invitations')
    .insert({
      salon_id: body.salon_id,
      email,
      role: body.role,
      staff_id: body.staff_id ?? null,
      auto_create_staff: !!body.auto_create_staff,
      token,
      invited_by: userId,
      invited_first_name:
        typeof body.invited_first_name === 'string' && body.invited_first_name
          ? body.invited_first_name
          : null,
      invited_last_name:
        typeof body.invited_last_name === 'string' && body.invited_last_name
          ? body.invited_last_name
          : null,
      invited_phone:
        typeof body.invited_phone === 'string' && body.invited_phone ? body.invited_phone : null,
    })
    .select('id, expires_at')
    .single()
  if (insErr || !inv) {
    return jsonResponse({ ok: false, error: 'create_failed', message: insErr?.message }, 500)
  }

  // Salon name + logo для письма
  const { data: salon } = await admin
    .from('salons')
    .select('name, logo_url')
    .eq('id', body.salon_id)
    .single()
  const { data: invUser } = await admin.auth.admin.getUserById(userId)
  const inviterName =
    (invUser?.user?.user_metadata as { full_name?: string } | null)?.full_name ??
    invUser?.user?.email ??
    'Owner'

  // Базовый «accept»-URL — он содержит наш token и работает для уже
  // авторизованного юзера. Если приглашённый ещё не зарегистрирован —
  // оборачиваем в Supabase invite-link, который создаст auth.user, подтвердит
  // email, залогинит и сделает redirect сюда же. Для уже существующих юзеров —
  // просто наша ссылка (откроется на /login → /accept-invite после ввода
  // пароля или magic-link).
  const acceptUrl = `${APP_URL}accept-invite?token=${encodeURIComponent(token)}`

  let finalInviteUrl = acceptUrl
  if (!existing) {
    try {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: acceptUrl },
      })
      const actionLink = (linkData as unknown as { properties?: { action_link?: string } })
        ?.properties?.action_link
      if (linkErr) {
        console.warn('generateLink invite failed, using plain accept URL:', linkErr.message)
      } else if (actionLink) {
        finalInviteUrl = actionLink
      }
    } catch (e) {
      console.warn(
        'generateLink invite exception, using plain accept URL:',
        e instanceof Error ? e.message : e,
      )
    }
  }

  try {
    await sendEmail('team_invitation', email, {
      inviter_name: inviterName,
      salon_name: salon?.name ?? 'Salon',
      logo_block: renderLogoBlock((salon as { logo_url?: string | null } | null)?.logo_url),
      role: body.role,
      invite_url: finalInviteUrl,
      expires_in_days: '14',
    })
  } catch (e) {
    console.warn('email send failed, invitation still created:', e instanceof Error ? e.message : e)
  }

  return jsonResponse({ ok: true, invitation_id: inv.id, invite_url: finalInviteUrl })
}

async function handleCancel(
  admin: SupabaseClient,
  userId: string,
  body: { invitation_id?: string },
): Promise<Response> {
  if (!body.invitation_id) return jsonResponse({ ok: false, error: 'invitation_id_required' }, 400)
  const { data: inv } = await admin
    .from('salon_invitations')
    .select('salon_id')
    .eq('id', body.invitation_id)
    .maybeSingle()
  if (!inv) return jsonResponse({ ok: false, error: 'not_found' }, 404)
  if (!(await ensureAdmin(admin, userId, inv.salon_id))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  await admin
    .from('salon_invitations')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', body.invitation_id)
  return jsonResponse({ ok: true })
}

import { withSentry } from '../_shared/sentry.ts'

Deno.serve(
  withSentry('send-invitation', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }
    const userJwt = authHeader.slice('Bearer '.length)

    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    })
    const { data: userRes, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userRes?.user) {
      return jsonResponse({ ok: false, error: 'invalid_token' }, 401)
    }
    const userId = userRes.user.id

    let body: { action?: string; [k: string]: unknown }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    switch (body.action) {
      case 'create':
        return handleCreate(
          admin,
          userId,
          body as {
            salon_id?: string
            email?: string
            role?: string
            staff_id?: string | null
          },
        )
      case 'cancel':
        return handleCancel(admin, userId, body as { invitation_id?: string })
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
    }
  }),
)
