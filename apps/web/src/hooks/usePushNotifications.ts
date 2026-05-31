import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
  // React Query вместо локального useState — useSubscribePush invalidate'ит
  // `['push-permission']`, чтобы карточка PushNotificationsCard сразу же
  // исчезла после успешной подписки (без перезагрузки страницы).
  const { data, isLoading } = useQuery({
    queryKey: ['push-permission'],
    queryFn: async (): Promise<{ state: PushPermissionState; isSubscribed: boolean }> => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        return { state: 'unsupported', isSubscribed: false }
      }
      const state = Notification.permission as PushPermissionState
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        // Idempotent sync: если в браузере есть подписка — сразу же шлём её
        // в БД (upsert по endpoint). Это лечит рассинхрон когда подписка
        // удалена с сервера, но Service Worker всё ещё её помнит.
        if (sub) {
          const json = sub.toJSON() as {
            endpoint: string
            keys?: { p256dh?: string; auth?: string }
          }
          if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
            void supabase.functions.invoke('send-push', {
              body: {
                action: 'subscribe',
                endpoint: json.endpoint,
                p256dh: json.keys.p256dh,
                auth: json.keys.auth,
                userAgent: navigator.userAgent,
              },
            })
          }
        }
        return { state, isSubscribed: !!sub }
      } catch {
        return { state, isSubscribed: false }
      }
    },
    staleTime: 60_000,
  })

  return {
    state: data?.state ?? 'default',
    isSubscribed: data?.isSubscribed ?? false,
    loading: isLoading,
  }
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

/**
 * Принудительная пересинхронизация: разрывает текущую браузерную подписку
 * (если есть) и подписывается заново с актуальным VAPID public key.
 *
 * Нужно когда сервер ротировал VAPID-пару — старые подписки в БД удалены,
 * но Service Worker всё ещё помнит свою подписку с устаревшим publicKey.
 * Push-сервис возвращает 410 на такие подписки.
 */
async function resubscribePushInternal(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('vapid_public_key_missing')
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('push_unsupported')
  }
  const reg = await navigator.serviceWorker.ready
  // Разрываем старую (если есть). Не падаем если её нет.
  const oldSub = await reg.pushManager.getSubscription()
  if (oldSub) {
    try {
      await oldSub.unsubscribe()
      await supabase.functions.invoke('send-push', {
        body: { action: 'unsubscribe', endpoint: oldSub.endpoint },
      })
    } catch {
      // не критично — следующий subscribe всё перезапишет
    }
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('permission_denied')
  const newSub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const json = newSub.toJSON() as {
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
}

/** Послать тестовое уведомление текущему юзеру (на все его устройства).
 *
 *  При ошибке вытаскиваем response.body — supabase-js по умолчанию выкидывает
 *  generic «Failed to send a request», что бесполезно для дебага.
 *
 *  При no_subscriptions от сервера (БД пуста, но в браузере подписка есть —
 *  типичный случай после ротации VAPID-ключей) автоматически пересоздаёт
 *  подписку и ретраит тест. Юзер не должен думать о ручном «Отключить →
 *  Включить заново».
 */
export function useTestPush() {
  return useMutation({
    mutationFn: async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('push_unsupported')
      }

      // 1-я попытка: тест по текущей подписке.
      let result = await invokeSendPushTest()

      // Если БД говорит «нет подписок» — типичный рассинхрон после rotate
      // VAPID-пары. Заново регистрируем и ретраим.
      if (result.errorCode === 'no_subscriptions') {
        await resubscribePushInternal()
        result = await invokeSendPushTest()
      }

      // Fallback: edge function недоступна (не задеплоена или VAPID
      // secrets отсутствуют). Показываем native browser notification
      // через service worker — это даёт пользователю визуальный feedback
      // что разрешение работает, а саму push-доставку фиксим отдельно.
      if (result.errorCode === 'push_function_unreachable') {
        const shown = await showLocalTestNotification()
        if (shown) return -1 // sentinel: «1 локально» вместо реального push
      }

      if (result.errorCode) throw new Error(result.errorCode)
      if (result.errorMessage) throw new Error(result.errorMessage)
      return result.sent
    },
  })
}

/**
 * Показ локального уведомления через service worker. Используется как
 * fallback когда edge function send-push не отвечает (не задеплоена / нет
 * VAPID secrets), чтобы пользователь хотя бы видел что разрешение работает.
 */
async function showLocalTestNotification(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false
    if (Notification.permission !== 'granted') return false
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return false
    await reg.showNotification('Finkley · Test (локально)', {
      body: 'Edge-функция send-push временно недоступна. Это локальное уведомление через Service Worker — показано чтобы проверить разрешение браузера.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'finkley-test-local',
    })
    return true
  } catch {
    return false
  }
}

type TestResult = {
  sent: number
  errorCode: string | null
  errorMessage: string | null
}

async function invokeSendPushTest(): Promise<TestResult> {
  const { data, error } = await supabase.functions.invoke('send-push', {
    body: { action: 'test' },
  })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: string }
        if (body?.error) return { sent: 0, errorCode: body.error, errorMessage: null }
      } catch {
        // ignore parse error — fall through
      }
    }
    const msg = error.message || String(error)
    if (msg.toLowerCase().includes('failed to send')) {
      return { sent: 0, errorCode: 'push_function_unreachable', errorMessage: null }
    }
    return { sent: 0, errorCode: null, errorMessage: msg }
  }
  const json = data as { ok: boolean; sent?: number; failed?: number; error?: string }
  if (!json.ok) return { sent: 0, errorCode: json.error ?? 'test_failed', errorMessage: null }
  return { sent: json.sent ?? 0, errorCode: null, errorMessage: null }
}
