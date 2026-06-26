import { lazy, type ComponentType } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>

const RELOAD_KEY = 'finkley:chunk-reloaded'

/**
 * Похоже ли это на ошибку устаревшего чанка после деплоя?
 *
 * Прямой случай — 404 на чанк («Failed to fetch dynamically imported module»).
 * Но несоответствие чанков проявляется и как TypeError при инициализации
 * частично-загруженного графа модулей: напр. "Cannot read properties of null
 * (reading 'cached')" при заходе на /admin/media сразу после релиза. Все они
 * лечатся одинаково — reload свежего index.html.
 */
export function isStaleChunkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    /Cannot read propert(y|ies) of (null|undefined)/i.test(msg) ||
    /(null|undefined) is not an? (object|function)/i.test(msg) ||
    msg.includes('is not a function')
  )
}

/**
 * Один раз за сессию: чистим SW + caches и перезагружаем страницу, чтобы
 * подтянуть свежий index.html с актуальными хэшами чанков. Флаг в sessionStorage
 * предотвращает бесконечный цикл, если ошибка реальная (после reload повторится).
 * Возвращает true, если запустил reload (страница вот-вот перезагрузится).
 */
export async function recoverFromStaleChunkOnce(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false
    sessionStorage.setItem(RELOAD_KEY, '1')
  } catch {
    return false
  }
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
  return true
}

/** Сброс флага после успешной загрузки — чтобы при следующем релизе снова
 *  можно было разово перезагрузиться. */
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * lazy() с авто-перезагрузкой при stale chunks.
 *
 * Когда мы деплоим новый bundle, старый клиент со старым index.html пытается
 * lazy-load чанки с прошлыми хэшами. Их больше нет на CDN → ошибка загрузки
 * (404 или TypeError частично-загруженного графа). Ловим её и делаем разовый
 * reload, который подтянет свежий index.html. На случай, если ошибка всплывёт
 * уже при рендере (не в import) — то же восстановление есть в RouteErrorBoundary.
 */
export function lazyWithRetry<T extends AnyComponent>(loader: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await loader()
      // Успешная загрузка — сбрасываем флаг (один reload на релиз).
      clearChunkReloadFlag()
      return mod
    } catch (e) {
      if (isStaleChunkError(e)) {
        const reloading = await recoverFromStaleChunkOnce()
        if (reloading) {
          // Возвращаем pending promise — компонент никогда не зарендерится,
          // потому что страница уже перезагружается.
          return new Promise<{ default: T }>(() => {})
        }
      }
      throw e
    }
  })
}
