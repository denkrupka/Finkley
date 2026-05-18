/**
 * React Query хуки для отображения tg_dialogs / tg_messages в /messenger.
 * Адаптер: возвращает данные в форме совместимой с MessengerConversation /
 * MessengerMessage чтобы переиспользовать UI компоненты.
 *
 * id-formate: чтобы не пересекаться с Bot API conversation ids, добавляем
 * префикс 'tg:' к dialog_id. SelectedId в MessengerPage = либо UUID (Bot API),
 * либо 'tg:<uuid>' (userbot).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

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
      // Join: только диалоги активных сессий этого салона
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
          'id, session_id, tg_chat_id, type, title, username, last_message_text, last_message_at, unread_count, pinned, archived',
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

export function useTgSendPhoto(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      session_id: string
      dialog_id: string
      file: File
      caption?: string
    }) => {
      const ext = input.file.name.split('.').pop() || 'jpg'
      const storagePath = `upload/${input.session_id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('tg-media')
        .upload(storagePath, input.file, {
          contentType: input.file.type || 'image/jpeg',
          upsert: false,
        })
      if (upErr) throw upErr
      const { error } = await supabase.from('tg_outbox').insert({
        session_id: input.session_id,
        dialog_id: input.dialog_id,
        action: 'send_photo',
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

// ---------------------------------------------------------------------------
// Signed URL для медиа (tg-media bucket приватный)
// ---------------------------------------------------------------------------

export async function getTgMediaSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('tg-media').createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}
