import { lazy, type ComponentType } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>

/**
 * lazy() с авто-перезагрузкой при stale chunks.
 *
 * Когда мы деплоим новый bundle, старый клиент со старым index.html
 * пытается lazy-load чанки с прошлыми хэшами в имени. Их больше нет
 * на CDN → "Failed to fetch dynamically imported module" → пустой
 * экран и Sentry-алерт.
 *
 * Решение: ловим именно эту ошибку и делаем window.location.reload(),
 * который подтянет свежий index.html с новыми хэшами. Делается ровно
 * один раз — флаг в sessionStorage предотвращает бесконечный цикл,
 * если ошибка реальная (404 и т.п.).
 */
export function lazyWithRetry<T extends AnyComponent>(loader: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await loader()
      // Успешная загрузка — сбрасываем флаг, чтобы при следующем релизе
      // снова можно было перезагрузить страницу (один раз на релиз).
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('finkley:chunk-reloaded')
      }
      return mod
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const isStaleChunk =
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('error loading dynamically imported module')

      if (isStaleChunk && typeof window !== 'undefined') {
        const reloadedKey = 'finkley:chunk-reloaded'
        const alreadyReloaded = sessionStorage.getItem(reloadedKey)
        if (!alreadyReloaded) {
          sessionStorage.setItem(reloadedKey, '1')
          // Stale chunk почти всегда = SW кэширует старый shell, который
          // ссылается на удалённые чанки. Очищаем caches + unregister SW
          // ДО reload, чтобы свежий index.html гарантированно подтянулся.
          try {
            if ('caches' in window) {
              const keys = await caches.keys()
              await Promise.all(keys.map((k) => caches.delete(k)))
            }
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations()
              await Promise.all(regs.map((r) => r.unregister()))
            }
          } catch {
            // best-effort, всё равно делаем reload
          }
          window.location.reload()
          // Возвращаем pending promise — компонент никогда не зарендерится
          // потому что страница уже перезагружается
          return new Promise<{ default: T }>(() => {})
        }
      }
      throw e
    }
  })
}
