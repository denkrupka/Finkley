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

// T199 — унифицированный prefix для всего онбординг-транзита (credentials
// и prompt в одном JSON). credentials sub-key содержит per-provider creds,
// prompt sub-key — строка из comma-separated provider id'ов.
const STORAGE_PREFIX = 'finkley:onboarding'

type CredentialsBySalon = Record<string, Record<string, string>>

type StorageShape = {
  credentials?: CredentialsBySalon
  prompt?: string
}

function storageKey(salonId: string): string {
  return `${STORAGE_PREFIX}:${salonId}`
}

function readStorage(salonId: string): StorageShape {
  try {
    const raw = localStorage.getItem(storageKey(salonId))
    if (raw) {
      const parsed = JSON.parse(raw) as StorageShape
      return typeof parsed === 'object' && parsed !== null ? parsed : {}
    }
    // T203 — backward-compat миграция: legacy keys
    // finkley:onboarding:credentials:<salon> и finkley:onboarding:prompt:<salon>
    // читаются и записываются в новый unified формат.
    const legacyCreds = localStorage.getItem(`finkley:onboarding:credentials:${salonId}`)
    const legacyPrompt = localStorage.getItem(`finkley:onboarding:prompt:${salonId}`)
    if (!legacyCreds && !legacyPrompt) return {}
    const migrated: StorageShape = {}
    if (legacyCreds) {
      try {
        const c = JSON.parse(legacyCreds) as CredentialsBySalon
        if (typeof c === 'object' && c !== null) migrated.credentials = c
      } catch {
        /* ignore malformed */
      }
    }
    if (legacyPrompt) migrated.prompt = legacyPrompt
    // Записываем в новый ключ и удаляем legacy.
    if (Object.keys(migrated).length > 0) {
      localStorage.setItem(storageKey(salonId), JSON.stringify(migrated))
    }
    localStorage.removeItem(`finkley:onboarding:credentials:${salonId}`)
    localStorage.removeItem(`finkley:onboarding:prompt:${salonId}`)
    return migrated
  } catch {
    return {}
  }
}

function writeStorage(salonId: string, value: StorageShape): void {
  try {
    const hasCreds = !!value.credentials && Object.keys(value.credentials).length > 0
    const hasPrompt = !!value.prompt
    if (!hasCreds && !hasPrompt) {
      localStorage.removeItem(storageKey(salonId))
      // T221 — также чистим legacy на write-empty (deploy rollback safety).
      localStorage.removeItem(`finkley:onboarding:credentials:${salonId}`)
      localStorage.removeItem(`finkley:onboarding:prompt:${salonId}`)
    } else {
      localStorage.setItem(storageKey(salonId), JSON.stringify(value))
      // T221 — dual-write в legacy формат на случай rollback'a в ближайшие
      // 2 недели. После 2026-06-15 эти строки можно удалить — все юзеры
      // пройдут через unified формат.
      if (hasCreds) {
        try {
          localStorage.setItem(
            `finkley:onboarding:credentials:${salonId}`,
            JSON.stringify(value.credentials),
          )
        } catch {
          /* ignore */
        }
      }
      if (hasPrompt) {
        try {
          localStorage.setItem(`finkley:onboarding:prompt:${salonId}`, value.prompt!)
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    // ignore — storage недоступен (private mode)
  }
}

function readAll(salonId: string): CredentialsBySalon {
  return readStorage(salonId).credentials ?? {}
}

function writeAll(salonId: string, value: CredentialsBySalon): void {
  const cur = readStorage(salonId)
  writeStorage(salonId, { ...cur, credentials: value })
}

/** T199 — credentials + prompt в один write. Используется OnboardingPage
 *  чтобы не делать двух localStorage записей подряд. */
export function saveOnboardingTransit(
  salonId: string,
  payload: { credentials?: CredentialsBySalon; prompt?: string },
): void {
  writeStorage(salonId, payload)
}

/** T199 — one-shot чтение prompt + удаление. Используется IntegrationsPage. */
export function consumeOnboardingPrompt(salonId: string): string | null {
  const cur = readStorage(salonId)
  if (!cur.prompt) return null
  const prompt = cur.prompt
  writeStorage(salonId, { ...cur, prompt: undefined })
  return prompt
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
