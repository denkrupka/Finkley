/**
 * tester-bug-report — endpoint для багов от пользователей с флагом
 * profiles.is_tester=true (доверенные тестеры). Запись попадает сразу в
 * работу: source='tester', requires_approval=false (без модерации, в отличие
 * от 'client'-багов с DM-бота).
 *
 * Auth: Bearer JWT текущего юзера. Проверяем что у него is_tester=true.
 *
 * Body (JSON):
 *   {
 *     description: string,
 *     screenshot_base64?: string,  — data: URL для скрина выделенной области
 *     attachment_base64?: string,  — для прикреплённого файла/фото
 *     attachment_mime?: string,
 *     attachment_name?: string,
 *     page_url?: string,           — URL страницы откуда сообщён баг
 *     user_agent?: string
 *   }
 *
 * Deploy: --no-verify-jwt (сами проверяем через getUserFromRequest)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

/** "data:image/png;base64,iVBO..." → { mime, bytes } */
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return null
  const mime = m[1]!
  const b64 = m[2]!
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { mime, bytes }
  } catch {
    return null
  }
}

async function uploadAttachment(
  admin: ReturnType<typeof createClient>,
  bytes: Uint8Array,
  mime: string,
  bugIdHint: string,
  filenameHint: string,
): Promise<{ storage_path: string; mime: string; size: number } | null> {
  const ext = (mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '')
  const safeName = filenameHint.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || `file.${ext}`
  const path = `${bugIdHint}/${Date.now()}-${safeName}`
  const { error } = await admin.storage
    .from('bug-attachments')
    .upload(path, bytes, { contentType: mime, upsert: false })
  if (error) {
    console.warn('upload failed', error)
    return null
  }
  return { storage_path: path, mime, size: bytes.length }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'function_not_configured' }, 500)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Проверяем что юзер — тестировщик (только они могут слать через этот endpoint).
  const { data: profile } = await admin
    .from('profiles')
    .select('id, is_tester, full_name')
    .eq('id', user.userId)
    .maybeSingle()
  if (!profile || !(profile as { is_tester?: boolean }).is_tester) {
    return json({ error: 'not_a_tester' }, 403)
  }

  let body: {
    description?: string
    screenshot_base64?: string
    attachment_base64?: string
    attachment_mime?: string
    attachment_name?: string
    page_url?: string
    user_agent?: string
    salon_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const description = (body.description ?? '').trim()
  if (!description) return json({ error: 'description_required' }, 400)

  // Сначала создаём bug_reports без attachments, получаем id для пути в storage
  const { data: inserted, error: insErr } = await admin
    .from('bug_reports')
    .insert({
      telegram_chat_id: null,
      telegram_message_id: null,
      sender_id: null,
      sender_username: null,
      sender_first_name: (profile as { full_name?: string | null }).full_name ?? null,
      message_text: description,
      attachments: [],
      reported_at: new Date().toISOString(),
      kind: 'bug',
      source: 'tester',
      requires_approval: false,
      status: 'open',
      reporter_user_id: user.userId,
      salon_id: typeof body.salon_id === 'string' && body.salon_id ? body.salon_id : null,
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    console.error('insert bug_reports failed', insErr)
    return json({ error: insErr?.message ?? 'insert_failed' }, 500)
  }
  const bugId = inserted.id as string

  // Загружаем attachments (скрин + файл, если есть)
  const attachments: Array<{
    type: string
    storage_path: string
    mime: string
    size: number
    name?: string
  }> = []

  if (body.screenshot_base64) {
    const decoded = decodeDataUrl(body.screenshot_base64)
    if (decoded) {
      const att = await uploadAttachment(
        admin,
        decoded.bytes,
        decoded.mime,
        bugId,
        'screenshot.png',
      )
      if (att) attachments.push({ type: 'screenshot', ...att })
    }
  }
  if (body.attachment_base64) {
    const decoded = decodeDataUrl(body.attachment_base64)
    if (decoded) {
      const mime = body.attachment_mime ?? decoded.mime
      const att = await uploadAttachment(
        admin,
        decoded.bytes,
        mime,
        bugId,
        body.attachment_name ?? 'attachment',
      )
      if (att) attachments.push({ type: 'file', name: body.attachment_name, ...att })
    }
  }

  if (attachments.length > 0) {
    await admin
      .from('bug_reports')
      .update({
        attachments,
        notes:
          [
            body.page_url ? `URL: ${body.page_url}` : null,
            body.user_agent ? `UA: ${body.user_agent}` : null,
          ]
            .filter(Boolean)
            .join('\n') || null,
      })
      .eq('id', bugId)
  } else if (body.page_url || body.user_agent) {
    await admin
      .from('bug_reports')
      .update({
        notes:
          [
            body.page_url ? `URL: ${body.page_url}` : null,
            body.user_agent ? `UA: ${body.user_agent}` : null,
          ]
            .filter(Boolean)
            .join('\n') || null,
      })
      .eq('id', bugId)
  }

  return json({ ok: true, id: bugId, attachments_count: attachments.length })
})
