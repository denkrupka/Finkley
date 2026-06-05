/**
 * Безопасно превращает любую ошибку (Error, PostgrestError, AuthApiError,
 * unknown) в строку для тоста / лога. Никогда не возвращает "[object Object]".
 */
export function formatError(err: unknown, fallback = 'Неизвестная ошибка'): string {
  if (err == null) return fallback
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || fallback

  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    // Supabase PostgrestError / AuthApiError shape
    const message =
      pickString(e, 'message') ??
      pickString(e, 'error_description') ??
      pickString(e, 'error') ??
      pickString(e, 'details') ??
      pickString(e, 'hint')
    if (message) return message

    // status + statusText (fetch-like)
    const status = pickString(e, 'statusText')
    if (status) return status

    try {
      const json = JSON.stringify(err)
      if (json && json !== '{}') return json
    } catch {
      // ignore stringify errors
    }
  }

  return fallback
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]
  return typeof v === 'string' && v.trim() ? v : null
}
