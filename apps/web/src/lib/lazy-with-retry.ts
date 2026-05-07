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
      return await loader()
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
