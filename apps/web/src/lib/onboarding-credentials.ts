/**
 * T150 — helper для чтения credentials, сохранённых онбордингом в localStorage
 * до перехода на /settings/integrations.
 *
 * Контракт:
 *   - OnboardingPage.onSubmit сохраняет credentials под ключом
 *     `finkley:onboarding:credentials:<salon_id>` (JSON-encoded
 *     Partial<Record<provider, Record<string, string>>>)
 *   - Connect dialog'и в /settings/integrations при mount читают свои
 *     credentials через consumeOnboardingCredentials(salonId, provider)
 *     — функция возвращает значения И удаляет их из storage, чтобы
 *     credentials не залипали навсегда (security: меньше окно exposure).
 */

const STORAGE_PREFIX = 'finkley:onboarding:credentials'

type CredentialsBySalon = Record<string, Record<string, string>>

function storageKey(salonId: string): string {
  return `${STORAGE_PREFIX}:${salonId}`
}

function readAll(salonId: string): CredentialsBySalon {
  try {
    const raw = localStorage.getItem(storageKey(salonId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CredentialsBySalon
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(salonId: string, value: CredentialsBySalon): void {
  try {
    if (Object.keys(value).length === 0) {
      localStorage.removeItem(storageKey(salonId))
    } else {
      localStorage.setItem(storageKey(salonId), JSON.stringify(value))
    }
  } catch {
    // ignore — storage недоступен (private mode)
  }
}

/**
 * Читает credentials конкретного провайдера и удаляет из storage.
 * One-shot — после consume permission'а нет.
 */
export function consumeOnboardingCredentials(
  salonId: string,
  provider: string,
): Record<string, string> | null {
  const all = readAll(salonId)
  const found = all[provider]
  if (!found) return null
  const { [provider]: _used, ...rest } = all
  void _used
  writeAll(salonId, rest)
  return found
}

/**
 * Peek без удаления — для случая когда диалог открылся, но юзер отменил,
 * и нужно сохранить credentials для повторного открытия.
 */
export function peekOnboardingCredentials(
  salonId: string,
  provider: string,
): Record<string, string> | null {
  return readAll(salonId)[provider] ?? null
}
