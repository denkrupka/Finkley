/**
 * Достоверный статус банковского подключения для карточек онбординга.
 *
 * Строка bank_connections создаётся со status='pending' ДО редиректа юзера в
 * банк (edge banking-connect). Если авторизация в банке не завершилась (юзер
 * закрыл вкладку, банк вернул ?error=...) — строка может остаться pending.
 * Поэтому pending НЕ считается подключением: «Подключено» показываем только
 * при явном status='connected'.
 */
export type BankConnectionStatusLike = {
  status: 'pending' | 'connected' | 'expired' | 'revoked' | 'error'
  created_at: string
  last_error?: string | null
}

export type BankDisplayStatus =
  | { kind: 'connected' }
  | { kind: 'error'; lastError: string | null }
  | { kind: 'none' }

export function bankDisplayStatus(
  connections: readonly BankConnectionStatusLike[],
): BankDisplayStatus {
  if (connections.some((c) => c.status === 'connected')) return { kind: 'connected' }
  // Ошибку показываем только для ПОСЛЕДНЕЙ попытки: старый error перекрытый
  // новым pending (юзер уже пробует снова) не должен пугать.
  const latest = [...connections].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (latest?.status === 'error') {
    return { kind: 'error', lastError: latest.last_error ?? null }
  }
  return { kind: 'none' }
}
