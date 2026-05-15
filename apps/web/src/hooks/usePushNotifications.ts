import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase/client'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(b64url: string): Uint8Array {
  const padding = '='.repeat((4 - (b64url.length % 4)) % 4)
  const base64 = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushPermissionState = 'unsupported' | 'denied' | 'granted' | 'default'

/**
 * Текущее состояние push-permission в браузере + текущая подписка.
 * Реактивно обновляется при subscribe/unsubscribe.
 */
export function usePushPermission(): {
  state: PushPermissionState
  isSubscribed: boolean
  loading: boolean
} {
  const [state, setState] = useState<PushPermissionState>('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    async function check() {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (mounted) {
          setState('unsupported')
          setLoading(false)
        }
        return
      }
      const perm = Notification.permission as PushPermissionState
      if (mounted) setState(perm)
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (mounted) setIsSubscribed(!!sub)
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void check()
    return () => {
      mounted = false
    }
  }, [])

  return { state, isSubscribed, loading }
}

/** Subscribe текущий браузер в push. Сохраняет на бэке через edge function. */
export function useSubscribePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!VAPID_PUBLIC_KEY) throw new Error('vapid_public_key_missing')
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('push_unsupported')
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') throw new Error('permission_denied')

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
      }

      const json = sub.toJSON() as {
        endpoint: string
        keys?: { p256dh?: string; auth?: string }
      }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('subscription_incomplete')
      }

      const { error } = await supabase.functions.invoke('send-push', {
        body: {
          action: 'subscribe',
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          userAgent: navigator.userAgent,
        },
      })
      if (error) throw error
      return true
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['push-permission'] })
    },
  })
}

/** Unsubscribe — снимает подписку и удаляет с бэка. */
export function useUnsubscribePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!('serviceWorker' in navigator)) return false
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) return true
      const endpoint = sub.endpoint
      await sub.unsubscribe()
      await supabase.functions.invoke('send-push', {
        body: { action: 'unsubscribe', endpoint },
      })
      return true
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['push-permission'] })
    },
  })
}

/** Послать тестовое уведомление текущему юзеру (на все его устройства).
 *
 *  При ошибке вытаскиваем response.body — supabase-js по умолчанию выкидывает
 *  generic «Failed to send a request», что бесполезно для дебага.
 */
export function useTestPush() {
  return useMutation({
    mutationFn: async () => {
      // Image #44: сначала проверим, что у браузера реально есть подписка.
      // Раньше юзер мог нажать «Тест» при отсутствии подписки (например, после
      // unsubscribe или если permission revoke'нут) — получал generic
      // «Failed to send a request» от supabase-js. Теперь — понятный текст.
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('push_unsupported')
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!sub) throw new Error('no_subscriptions')
      } catch (e) {
        // .ready может зависать если SW ещё не зарегистрирован, или getSubscription
        // выкинул — оба случая означают «нет рабочей подписки».
        if (e instanceof Error && e.message === 'no_subscriptions') throw e
      }

      const { data, error } = await supabase.functions.invoke('send-push', {
        body: { action: 'test' },
      })
      if (error) {
        // supabase-js v2: FunctionsHttpError имеет .context (Response). Парсим body
        // чтобы юзер увидел реальную причину вместо «Failed to send a request».
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = (await ctx.json()) as { error?: string }
            if (body?.error) throw new Error(body.error)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        // FunctionsFetchError без context — обычно CORS или функция не задеплоена.
        // Дадим diagnostic подсказку (а не голое "Failed to send a request").
        const msg = error.message || String(error)
        if (msg.toLowerCase().includes('failed to send')) {
          throw new Error('push_function_unreachable')
        }
        throw error
      }
      const json = data as { ok: boolean; sent?: number; failed?: number; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'test_failed')
      return json.sent ?? 0
    },
  })
}
