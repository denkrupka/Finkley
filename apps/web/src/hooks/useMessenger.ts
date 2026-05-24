import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { supabase } from '@/lib/supabase/client'

/**
 * Realtime: подписка на новые сообщения и обновления диалогов для данного
 * салона. Инвалидирует кеш React Query при INSERT/UPDATE → UI рисует новое
 * сообщение мгновенно без F5.
 *
 * Использовать в MessengerPage один раз на маунте.
 */
export function useMessengerRealtime(salonId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!salonId) return
    const channel = supabase
      .channel(`messenger:${salonId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messenger_messages',
          filter: `salon_id=eq.${salonId}`,
        },
        (payload) => {
          const row = payload.new as { conversation_id?: string }
          qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
          if (row.conversation_id) {
            qc.invalidateQueries({ queryKey: ['messenger-messages', row.conversation_id] })
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messenger_conversations',
          filter: `salon_id=eq.${salonId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messenger_conversations',
          filter: `salon_id=eq.${salonId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [salonId, qc])
}

export type MessengerChannel = 'telegram' | 'whatsapp' | 'instagram' | 'facebook' | 'internal'

export type MessengerConversation = {
  id: string
  salon_id: string
  channel: MessengerChannel
  external_user_id: string
  display_name: string
  avatar_url: string | null
  client_id: string | null
  unread_count: number
  last_message_at: string
  last_message_preview: string | null
  created_at: string
  archived_at: string | null
}

export type MessengerMessage = {
  id: string
  conversation_id: string
  salon_id: string
  direction: 'in' | 'out'
  text: string | null
  media_path: string | null
  media_kind: 'image' | 'video' | 'audio' | 'file' | null
  external_message_id: string | null
  sent_by_user_id: string | null
  created_at: string
}

export type MessengerIntegration = {
  id: string
  salon_id: string
  channel: MessengerChannel
  status: 'disconnected' | 'pending' | 'connected' | 'error'
  external_account_id: string | null
  display_name: string | null
  last_synced_at: string | null
  last_error: string | null
}

export function useConversations(
  salonId: string | undefined,
  filter?: { channel?: MessengerChannel | null; search?: string },
) {
  const filterKey = filter ?? {}
  return useQuery<MessengerConversation[]>({
    queryKey: ['messenger-conversations', salonId, filterKey],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('messenger_conversations')
        .select(
          'id, salon_id, channel, external_user_id, display_name, avatar_url, client_id, unread_count, last_message_at, last_message_preview, created_at, archived_at',
        )
        .eq('salon_id', salonId)
        .is('archived_at', null)
        .order('last_message_at', { ascending: false })
        .limit(200)
      if (filter?.channel) q = q.eq('channel', filter.channel)
      if (filter?.search) q = q.ilike('display_name', `%${filter.search}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as MessengerConversation[]
    },
    enabled: !!salonId,
    staleTime: 10_000,
  })
}

export function useConversationMessages(conversationId: string | undefined) {
  return useQuery<MessengerMessage[]>({
    queryKey: ['messenger-messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return []
      const { data, error } = await supabase
        .from('messenger_messages')
        .select(
          'id, conversation_id, salon_id, direction, text, media_path, media_kind, external_message_id, sent_by_user_id, created_at',
        )
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(500)
      if (error) throw error
      return (data ?? []) as MessengerMessage[]
    },
    enabled: !!conversationId,
    staleTime: 5_000,
  })
}

export function useSendMessage(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      conversation_id: string
      text?: string
      media_path?: string
      media_kind?: MessengerMessage['media_kind']
    }) => {
      if (!salonId) throw new Error('no_salon')

      // Все исходящие — через edge function messenger-send: она и пушит в
      // внешний канал (TG/FB/IG), и пишет в БД. Если edge function недоступна
      // — пишем напрямую в БД как fallback (без доставки клиенту).
      const { data, error } = await supabase.functions.invoke('messenger-send', {
        body: {
          salon_id: salonId,
          conversation_id: input.conversation_id,
          text: input.text ?? '',
          media_path: input.media_path,
          media_kind: input.media_kind,
        },
      })
      if (error) {
        const fallback = await supabase
          .from('messenger_messages')
          .insert({
            conversation_id: input.conversation_id,
            salon_id: salonId,
            direction: 'out',
            text: input.text ?? null,
            media_path: input.media_path ?? null,
            media_kind: input.media_kind ?? null,
          })
          .select('*')
          .single()
        if (fallback.error) throw fallback.error
        return fallback.data as MessengerMessage
      }
      return data as MessengerMessage
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['messenger-messages', vars.conversation_id] })
      qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
    },
  })
}

/**
 * Запуск OAuth-флоу для подключения FB/IG канала. Вызывает edge function
 * `<channel>-oauth-callback?action=start&salon_id=...` с JWT юзера,
 * получает `authorize_url`, и редиректит браузер на Meta OAuth.
 *
 * Юзер на Meta логинится → одобряет permissions → Meta редиректит обратно
 * на edge function callback → она кладёт integration в БД и редиректит
 * на /{salonId}/settings/integrations?fb=connected (или ig=connected).
 */
export function useStartOAuth(salonId: string | undefined) {
  return useMutation({
    mutationFn: async (channel: 'facebook' | 'instagram' | 'whatsapp') => {
      if (!salonId) throw new Error('no_salon')
      const fnName =
        channel === 'facebook'
          ? 'fb-oauth-callback'
          : channel === 'instagram'
            ? 'instagram-oauth-callback'
            : 'whatsapp-oauth-callback'
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('not_authenticated')
      const baseUrl = import.meta.env.VITE_SUPABASE_URL
      const url = `${baseUrl}/functions/v1/${fnName}?action=start&salon_id=${encodeURIComponent(salonId)}`
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `HTTP ${r.status}`)
      }
      const j = (await r.json()) as { authorize_url?: string }
      if (!j.authorize_url) throw new Error('no_authorize_url')
      return j.authorize_url
    },
  })
}

/**
 * Привязывает conversation к существующему клиенту (или отвязывает если null).
 * Используется когда пользователь создаёт нового клиента из шапки чата —
 * после создания мы линкуем эту переписку, и при следующем сообщении видно
 * что клиент уже в базе.
 */
export function useLinkConversationClient(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { conversationId: string; clientId: string | null }) => {
      const { error } = await supabase
        .from('messenger_conversations')
        .update({ client_id: input.clientId })
        .eq('id', input.conversationId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
    },
  })
}

export function useConnectMessenger(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      channel: Exclude<MessengerChannel, 'internal'>
      credentials: Record<string, string>
    }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('messenger-connect', {
        body: {
          action: 'connect',
          salon_id: salonId,
          channel: input.channel,
          credentials: input.credentials,
        },
      })
      if (error) throw error
      const payload = data as {
        ok?: boolean
        status?: 'connected' | 'pending'
        external_account_id?: string
        display_name?: string
        error?: string
        message?: string
      }
      if (!payload?.ok) throw new Error(payload?.message ?? payload?.error ?? 'connect_failed')
      return payload as { status: 'connected' | 'pending' }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messenger-integrations', salonId] })
    },
  })
}

/**
 * Загружает файл в bucket `messenger-media` под путь
 * `<salonId>/<conversationId>/<uuid>.<ext>` и возвращает (path, mediaKind).
 * mediaKind определяется по MIME — image/video/audio/file.
 */
export async function uploadMessengerMedia(
  salonId: string,
  conversationId: string,
  file: File,
): Promise<{ path: string; mediaKind: 'image' | 'video' | 'audio' | 'file'; mime: string }> {
  const mime = file.type
  const mediaKind: 'image' | 'video' | 'audio' | 'file' = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : 'file'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const id = crypto.randomUUID()
  const path = `${salonId}/${conversationId}/${id}.${ext}`
  const { error } = await supabase.storage.from('messenger-media').upload(path, file, {
    contentType: mime || undefined,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error
  return { path, mediaKind, mime }
}

/** Возвращает signed-url (3 часа TTL) для отображения media в чате. */
export async function getMessengerMediaUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('messenger-media')
    .createSignedUrl(path, 60 * 60 * 3)
  if (error) return null
  return data?.signedUrl ?? null
}

export function useDisconnectMessenger(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (channel: Exclude<MessengerChannel, 'internal'>) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('messenger-connect', {
        body: { action: 'disconnect', salon_id: salonId, channel },
      })
      if (error) throw error
      return data as { ok: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messenger-integrations', salonId] })
    },
  })
}

export function useMarkConversationRead(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('messenger_conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
    },
  })
}

export function useMessengerIntegrations(salonId: string | undefined) {
  return useQuery<MessengerIntegration[]>({
    queryKey: ['messenger-integrations', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('messenger_integrations')
        .select(
          'id, salon_id, channel, status, external_account_id, display_name, last_synced_at, last_error',
        )
        .eq('salon_id', salonId)
      if (error) throw error
      return (data ?? []) as MessengerIntegration[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/** Создаёт internal-conversation для теста UI без подключённых каналов. */
export function useCreateInternalConversation(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { display_name: string }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('messenger_conversations')
        .insert({
          salon_id: salonId,
          channel: 'internal',
          external_user_id: `internal-${crypto.randomUUID()}`,
          display_name: input.display_name,
        })
        .select('*')
        .single()
      if (error) throw error
      return data as MessengerConversation
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
    },
  })
}

/** Bulk-send: отправить одно сообщение во все conversation_ids. */
export function useBulkBroadcast(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { conversation_ids: string[]; text: string }) => {
      if (!salonId) throw new Error('no_salon')
      if (input.conversation_ids.length === 0) return { inserted: 0 }
      const rows = input.conversation_ids.map((id) => ({
        conversation_id: id,
        salon_id: salonId,
        direction: 'out' as const,
        text: input.text,
      }))
      const { data, error } = await supabase.from('messenger_messages').insert(rows).select('id')
      if (error) throw error
      return { inserted: data?.length ?? 0 }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messenger-conversations', salonId] })
    },
  })
}
