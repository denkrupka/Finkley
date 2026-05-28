/**
 * T201 — pure helper для парсинга и обработки prompt queue в онбординге.
 *
 * Используется в IntegrationsPage для:
 *  - парсинг comma-separated `?prompt=booksy,wfirma,ksef`
 *  - shift head из очереди при открытии диалога
 *  - сериализация обратно в URL string
 *
 * Выделено в pure helper чтобы юнит-тестировать без рендера компонента.
 */

export function parsePromptQueue(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function shiftPromptQueue(queue: string[]): {
  head: string | null
  rest: string[]
} {
  if (queue.length === 0) return { head: null, rest: [] }
  return { head: queue[0]!, rest: queue.slice(1) }
}

export function serializePromptQueue(queue: string[]): string | null {
  if (queue.length === 0) return null
  return queue.join(',')
}
