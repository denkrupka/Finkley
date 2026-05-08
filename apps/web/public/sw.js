/**
 * Минимальный service worker для PWA install criteria + offline fallback.
 *
 * Стратегия:
 *   - Network-first для всех запросов (свежие данные приоритетнее).
 *   - При оффлайне — отдаём кэшированный shell для навигаций (чтобы пользователь
 *     видел app-shell, а не «нет интернета»). Все остальные запросы (Supabase,
 *     fonts, etc.) просто падают — RQ кэш и retry разберутся.
 *   - Без precache: на десктопе install-prompt всё равно появится по minimal SW.
 *
 * Версионирование: при изменении логики бампать `CACHE_NAME` — старый кэш чистится
 * в `activate`. Сейчас single-version, потому что precache пустой.
 */

const CACHE_NAME = 'finkley-shell-v1'
const APP_SHELL = '/app/'

self.addEventListener('install', (event) => {
  // Сразу активироваться, не ждать закрытия старых вкладок
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(APP_SHELL).catch(() => undefined)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Чистим старые версии кэша
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
        ),
      self.clients.claim(),
    ]),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // Обрабатываем только GET — POST/PUT всегда идут в сеть напрямую
  if (req.method !== 'GET') return

  // Только same-origin (Supabase API не кэшируем)
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Навигации: network-first с fallback на app shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => {
          // Обновляем кэш shell на лету
          if (response.ok) {
            const copy = response.clone()
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(APP_SHELL, copy))
              .catch(() => undefined)
          }
          return response
        })
        .catch(() => caches.match(APP_SHELL).then((r) => r ?? Response.error())),
    )
    return
  }

  // Static assets: cache-first для скорости (Vite добавляет hash в имя — invalidation бесплатна)
  if (url.pathname.startsWith('/app/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(req, copy))
              .catch(() => undefined)
          }
          return response
        })
      }),
    )
  }
})

// =============================================================================
// Web Push: показываем нотификацию из payload, по клику открываем нужный URL
// =============================================================================

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Finkley', body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'Finkley'
  const options = {
    body: payload.body || '',
    icon: '/app/icon-192.svg',
    badge: '/app/icon-192.svg',
    data: { url: payload.url || '/app/' },
    tag: payload.tag || 'finkley-default',
    requireInteraction: !!payload.requireInteraction,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/app/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      // Ищем уже открытое окно с приложением — фокусим его и навигируем
      for (const client of all) {
        if (client.url.includes('/app/') && 'focus' in client) {
          client.focus()
          if ('navigate' in client) client.navigate(targetUrl).catch(() => undefined)
          return
        }
      }
      // Иначе открываем новое окно
      if (self.clients.openWindow) self.clients.openWindow(targetUrl)
    }),
  )
})
