/**
 * React Query хуки для отображения tg_dialogs / tg_messages в /messenger.
 * Адаптер: возвращает данные в форме совместимой с MessengerConversation /
 * MessengerMessage чтобы переиспользовать UI компоненты.
 *
 * id-formate: чтобы не пересекаться с Bot API conversation ids, добавляем
 * префикс 'tg:' к dialog_id. SelectedId в MessengerPage = либо UUID (Bot API),
 * либо 'tg:<uuid>' (userbot).
 *
 * Lazy media: медиа из TG не качается worker'ом при поступлении сообщения.
 * Вместо этого SPA при открытии чата делает useTgDialogOpen → INSERT outbox
 * action='download_media' для каждого медиа без media_path. Через 5 минут
 * после закрытия чата cleanup-loop worker'а удаляет файлы из storage.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { supabase } from '@/lib/supabase/client'

const TG_PREFIX = 'tg:'

export function makeTgConvId(dialogId: string): string {
  return TG_PREFIX + dialogId
}

export function isTgConvId(id: string | null): boolean {
  return !!id && id.startsWith(TG_PREFIX)
}

export function parseTgConvId(id: string): string | null {
  return isTgConvId(id) ? id.slice(TG_PREFIX.length) : null
}

// ---------------------------------------------------------------------------
// Realtime для tg_messages — инвалидирует кеши при INSERT/UPDATE
// ---------------------------------------------------------------------------

export function useTgRealtime(salonId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!salonId) return
    const ch = supabase
      .channel(`tg:${salonId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tg_messages' }, (payload) => {
        const row = payload.new as { dialog_id?: string }
        qc.invalidateQueries({ queryKey: ['tg-dialogs', salonId] })
        if (row.dialog_id) {
          qc.invalidateQueries({ queryKey: ['tg-messages', row.dialog_id] })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tg_dialogs' }, () =>
        qc.invalidateQueries({ queryKey: ['tg-dialogs', salonId] }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [salonId, qc])
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export type TgDialog = {
  id: string
  session_id: string
  tg_chat_id: number
  type: 'user' | 'group' | 'channel' | 'bot'
  title: string | null
  username: string | null
  photo_path: string | null
  last_message_text: string | null
  last_message_at: string | null
  unread_count: number
  pinned: boolean
  archived: boolean
}

export function useTgDialogs(salonId: string | undefined) {
  return useQuery<TgDialog[]>({
    queryKey: ['tg-dialogs', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data: sessions, error: e1 } = await supabase
        .from('tg_sessions')
        .select('id')
        .eq('salon_id', salonId)
        .eq('status', 'active')
      if (e1) throw e1
      if (!sessions?.length) return []
      const sessionIds = sessions.map((s) => s.id)
      const { data, error } = await supabase
        .from('tg_dialogs')
        .select(
          'id, session_id, tg_chat_id, type, title, username, photo_path, last_message_text, last_message_at, unread_count, pinned, archived',
        )
        .in('session_id', sessionIds)
        .eq('archived', false)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as TgDialog[]
    },
    enabled: !!salonId,
    refetchInterval: 10_000,
  })
}

// ---------------------------------------------------------------------------
// Messages в диалоге
// ---------------------------------------------------------------------------

export type TgReaction = { emoji: string; count: number; chosen: boolean }

export type TgMessage = {
  id: string
  session_id: string
  dialog_id: string
  tg_message_id: number
  from_tg_user_id: number | null
  is_outgoing: boolean
  text: string | null
  media_kind: string | null
  media_path: string | null
  media_mime_type: string | null
  media_caption: string | null
  media_pending: boolean
  reactions: TgReaction[] | null
  reply_to_tg_message_id: number | null
  edited_at: string | null
  deleted: boolean
  delivered: boolean
  read_by_recipient_at: string | null
  sent_at: string
}

export function useTgMessages(dialogId: string | undefined) {
  return useQuery<TgMessage[]>({
    queryKey: ['tg-messages', dialogId],
    queryFn: async () => {
      if (!dialogId) return []
      const { data, error } = await supabase
        .from('tg_messages')
        .select('*')
        .eq('dialog_id', dialogId)
        .eq('deleted', false)
        .order('sent_at', { ascending: true })
        .limit(500)
      if (error) throw error
      return (data ?? []) as TgMessage[]
    },
    enabled: !!dialogId,
  })
}

// ---------------------------------------------------------------------------
// Lazy media: open/close диалога + автозаказ скачивания медиа
// ---------------------------------------------------------------------------

/**
 * Хук жизненного цикла открытого чата:
 *  - on mount: upsert tg_dialog_views.last_opened_at = now()
 *  - heartbeat каждую минуту: обновляем last_opened_at (показываем worker'у
 *    что чат всё ещё открыт)
 *  - on unmount: update last_closed_at = now()
 *
 * Также заказывает скачивание медиа для сообщений без media_path через
 * INSERT в tg_outbox action='download_media'.
 */
export function useTgDialogOpen(
  sessionId: string | undefined,
  dialogId: string | undefined,
  messages: TgMessage[] | undefined,
): void {
  const qc = useQueryClient()
  const requestedMsgIdsRef = useRef<Set<string>>(new Set())

  // Open + heartbeat + close
  useEffect(() => {
    if (!sessionId || !dialogId) return
    let cancelled = false

    const touch = async () => {
      if (cancelled) return
      const { error } = await supabase
        .from('tg_dialog_views')
        .upsert(
          { session_id: sessionId, dialog_id: dialogId, last_opened_at: new Date().toISOString() },
          { onConflict: 'session_id,dialog_id' },
        )
      if (error) {
        // не критично, просто логируем
        console.warn('tg_dialog_views upsert', error)
      }
    }
    void touch()
    const hb = setInterval(touch, 60_000)
    requestedMsgIdsRef.current.clear()

    return () => {
      cancelled = true
      clearInterval(hb)
      // Mark closed (fire and forget)
      void supabase
        .from('tg_dialog_views')
        .upsert(
          { session_id: sessionId, dialog_id: dialogId, last_closed_at: new Date().toISOString() },
          { onConflict: 'session_id,dialog_id', ignoreDuplicates: false },
        )
        .then(() => {})
    }
  }, [sessionId, dialogId])

  // Заказ скачивания медиа: для каждого медиа-сообщения без media_path
  // создаём outbox 'download_media' (один раз на сообщение в рамках open'а).
  useEffect(() => {
    if (!sessionId || !dialogId || !messages?.length) return
    const toRequest: TgMessage[] = []
    for (const m of messages) {
      if (m.deleted) continue
      if (!m.media_kind) continue
      if (m.media_path) continue
      if (m.media_pending) {
        requestedMsgIdsRef.current.add(m.id)
        continue
      }
      if (requestedMsgIdsRef.current.has(m.id)) continue
      requestedMsgIdsRef.current.add(m.id)
      toRequest.push(m)
    }
    if (!toRequest.length) return
    ;(async () => {
      // Помечаем pending=true локально через optimistic mark + INSERT в outbox
      const rows = toRequest.map((m) => ({
        session_id: sessionId,
        dialog_id: dialogId,
        action: 'download_media' as const,
        payload: { tg_message_id: m.tg_message_id },
      }))
      const { error: e1 } = await supabase.from('tg_outbox').insert(rows)
      if (e1) {
        console.warn('outbox download_media insert', e1)
        return
      }
      // media_pending пишет worker (через service_role); SPA не имеет UPDATE
      // policy на tg_messages — поэтому просто инвалидируем cache через ~3s.
      setTimeout(() => qc.invalidateQueries({ queryKey: ['tg-messages', dialogId] }), 2500)
    })()
  }, [sessionId, dialogId, messages, qc])
}

// ---------------------------------------------------------------------------
// Sending — INSERT в tg_outbox, worker подхватывает за ~1 сек
// ---------------------------------------------------------------------------

export function useTgSendText(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      session_id: string
      dialog_id: string
      text: string
      reply_to_tg_message_id?: number | null
    }) => {
      const { error } = await supabase.from('tg_outbox').insert({
        session_id: input.session_id,
        dialog_id: input.dialog_id,
        action: 'send_text',
        payload: {
          text: input.text,
          reply_to_tg_message_id: input.reply_to_tg_message_id ?? null,
        },
      })
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tg-messages', vars.dialog_id] })
      qc.invalidateQueries({ queryKey: ['tg-dialogs', salonId] })
    },
  })
}

/** Угадывает action по mime/имени файла: image → send_photo, video → send_video,
 * audio (ogg/opus) → send_voice, иначе send_document. */
function detectSendAction(
  file: File,
): 'send_photo' | 'send_video' | 'send_voice' | 'send_document' {
  const mime = file.type || ''
  if (mime.startsWith('image/')) return 'send_photo'
  if (mime.startsWith('video/')) return 'send_video'
  if (mime === 'audio/ogg' || mime === 'audio/opus' || /\.(ogg|opus)$/i.test(file.name))
    return 'send_voice'
  return 'send_document'
}

export function useTgSendFile(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      session_id: string
      dialog_id: string
      file: File
      caption?: string
    }) => {
      const action = detectSendAction(input.file)
      const safeName = input.file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80)
      const storagePath = `upload/${input.session_id}/${crypto.randomUUID()}-${safeName}`
      const { error: upErr } = await supabase.storage
        .from('tg-media')
        .upload(storagePath, input.file, {
          contentType: input.file.type || 'application/octet-stream',
          upsert: false,
        })
      if (upErr) throw upErr
      const { error } = await supabase.from('tg_outbox').insert({
        session_id: input.session_id,
        dialog_id: input.dialog_id,
        action,
        payload: {
          storage_path: storagePath,
          caption: input.caption || null,
        },
      })
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tg-messages', vars.dialog_id] })
      qc.invalidateQueries({ queryKey: ['tg-dialogs', salonId] })
    },
  })
}

/** @deprecated: используй useTgSendFile — он сам определит action. */
export const useTgSendPhoto = useTgSendFile

export function useTgMarkRead() {
  return useMutation({
    mutationFn: async (input: { session_id: string; dialog_id: string; tg_message_id: number }) => {
      const { error } = await supabase.from('tg_outbox').insert({
        session_id: input.session_id,
        dialog_id: input.dialog_id,
        action: 'mark_read',
        payload: { tg_message_id: input.tg_message_id },
      })
      if (error) throw error
    },
  })
}

export function useTgReact(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      session_id: string
      dialog_id: string
      tg_message_id: number
      emoji: string | null // null = снять реакцию
    }) => {
      const { error } = await supabase.from('tg_outbox').insert({
        session_id: input.session_id,
        dialog_id: input.dialog_id,
        action: 'react',
        payload: { tg_message_id: input.tg_message_id, emoji: input.emoji },
      })
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tg-messages', vars.dialog_id] })
      qc.invalidateQueries({ queryKey: ['tg-dialogs', salonId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Signed URL для медиа (tg-media bucket приватный)
// ---------------------------------------------------------------------------

const signedUrlCache = new Map<string, { url: string; expires: number }>()

export async function getTgMediaSignedUrl(path: string): Promise<string> {
  const cached = signedUrlCache.get(path)
  if (cached && cached.expires > Date.now()) return cached.url
  const { data, error } = await supabase.storage.from('tg-media').createSignedUrl(path, 3600)
  if (error) throw error
  signedUrlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60_000 })
  return data.signedUrl
}

/** Batch-подпись нескольких путей в одном запросе (для аватарок списка). */
export function useTgSignedUrls(paths: (string | null | undefined)[]): Record<string, string> {
  const unique = useMemo(() => Array.from(new Set(paths.filter((p): p is string => !!p))), [paths])
  const queryKey = ['tg-signed-urls', unique.join('|')]
  const q = useQuery<Record<string, string>>({
    queryKey,
    queryFn: async () => {
      if (!unique.length) return {}
      const result: Record<string, string> = {}
      const toFetch: string[] = []
      for (const p of unique) {
        const cached = signedUrlCache.get(p)
        if (cached && cached.expires > Date.now()) {
          result[p] = cached.url
        } else {
          toFetch.push(p)
        }
      }
      if (toFetch.length) {
        const { data, error } = await supabase.storage
          .from('tg-media')
          .createSignedUrls(toFetch, 3600)
        if (error) throw error
        for (const item of data ?? []) {
          if (item.signedUrl && item.path) {
            result[item.path] = item.signedUrl
            signedUrlCache.set(item.path, {
              url: item.signedUrl,
              expires: Date.now() + 50 * 60_000,
            })
          }
        }
      }
      return result
    },
    enabled: unique.length > 0,
    staleTime: 50 * 60_000,
  })
  return q.data ?? {}
}
