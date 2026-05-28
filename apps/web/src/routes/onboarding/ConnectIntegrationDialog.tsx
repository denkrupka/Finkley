import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { BrandIcon } from './BrandIcon'
import type { OnboardingIntegration, PendingCredentials } from './OnboardingPage'

/** T129 — credential fields для каждой интеграции. Для интеграций без
 *  credentials (banking/instagram/facebook/whatsapp/telegram/ical/ocr_notebook)
 *  — модалка показывает только описание + кнопку «Подключить».
 *  Реальное подключение происходит после submit'a онбординга в
 *  OnboardingPage.applyPendingIntegrations(). */
const CREDENTIAL_FIELDS: Partial<
  Record<
    OnboardingIntegration,
    Array<{ key: string; label: string; type: 'text' | 'password' | 'email' }>
  >
> = {
  booksy: [
    { key: 'email', label: 'Email от Booksy', type: 'email' },
    { key: 'password', label: 'Пароль', type: 'password' },
  ],
  wfirma: [
    { key: 'email', label: 'Email от wFirma', type: 'email' },
    { key: 'password', label: 'Пароль', type: 'password' },
  ],
  ksef: [
    { key: 'nip', label: 'NIP компании', type: 'text' },
    { key: 'token', label: 'Auth Token (из Mój KSeF)', type: 'password' },
  ],
  fakturownia: [
    { key: 'subdomain', label: 'Поддомен (например, mojaaplikacja)', type: 'text' },
    { key: 'api_token', label: 'API-токен', type: 'password' },
  ],
  ifirma: [
    { key: 'email', label: 'Email от iFirma', type: 'email' },
    { key: 'api_key', label: 'API-ключ', type: 'password' },
  ],
  infakt: [{ key: 'api_token', label: 'API-токен inFakt', type: 'password' }],
}

/**
 * T122 — модалка мгновенного подключения интеграции из онбординга.
 *
 * Открывается при клике на чекбокс интеграции (в Step3Accounting,
 * StepIntegrationsChoice, IntegrationCategoryStep). Показывает что произойдёт
 * после подтверждения. После «Подключить» — ставится ✓ в state.selected_integrations,
 * после создания салона OnboardingPage откроет соответствующий dialog
 * подключения с реальными credentials.
 *
 * Если интеграция уже выбрана — модалка не открывается, чекбокс просто
 * снимает выбор.
 */
/** Имя провайдера — продуктовое, не локализуется. */
const PROVIDER_NAME: Record<OnboardingIntegration, string> = {
  booksy: 'Booksy',
  wfirma: 'wFirma',
  banking: 'Банковский счёт',
  instagram: 'Instagram Direct',
  facebook: 'Facebook Messenger',
  whatsapp: 'WhatsApp Business',
  telegram: 'Telegram',
  ical: 'Google / Apple Calendar',
  ocr_notebook: 'Фото журнала',
  ksef: 'KSeF',
  fakturownia: 'Fakturownia',
  ifirma: 'iFirma',
  infakt: 'inFakt',
}

/** Сколько шагов «что произойдёт» для каждой интеграции — 3 у всех. */
const PROVIDER_STEPS_COUNT = 3

/** Есть ли подсказка про credentials для интеграции. */
const PROVIDER_HAS_HINT: Record<OnboardingIntegration, boolean> = {
  booksy: true,
  wfirma: true,
  banking: true,
  instagram: false,
  facebook: false,
  whatsapp: false,
  telegram: false,
  ical: false,
  ocr_notebook: false,
  ksef: false,
  fakturownia: false,
  ifirma: false,
  infakt: false,
}

export function ConnectIntegrationDialog({
  integration,
  open,
  onClose,
  onConfirm,
  existingCredentials,
}: {
  integration: OnboardingIntegration | null
  open: boolean
  onClose: () => void
  /** T129 — onConfirm получает заполненные credentials (или null если их нет
   *  для этой интеграции — banking/IG/FB/etc делают OAuth-flow после submit). */
  onConfirm: (credentials: PendingCredentials | null) => void
  existingCredentials?: PendingCredentials | null
}) {
  const { t } = useTranslation()
  // T129 — локальное состояние полей credentials (заполняется юзером).
  const [creds, setCreds] = useState<PendingCredentials>({})

  // Pre-fill из existingCredentials при открытии (если юзер уже сохранял).
  useEffect(() => {
    setCreds(existingCredentials ?? {})
  }, [existingCredentials, integration])

  if (!integration) return null
  const providerName = PROVIDER_NAME[integration]
  const tagline = t(`onboarding.connect_dialog.providers.${integration}.tagline`, {
    defaultValue: providerName,
  })
  const steps: string[] = []
  for (let i = 1; i <= PROVIDER_STEPS_COUNT; i++) {
    steps.push(
      t(`onboarding.connect_dialog.providers.${integration}.step_${i}`, { defaultValue: '' }),
    )
  }
  const hint = PROVIDER_HAS_HINT[integration]
    ? t(`onboarding.connect_dialog.providers.${integration}.hint`, { defaultValue: '' })
    : null
  const fields = CREDENTIAL_FIELDS[integration] ?? []
  const allRequiredFilled = fields.every((f) => (creds[f.key] ?? '').trim().length > 0)

  function handleConfirm() {
    if (fields.length > 0) {
      onConfirm({ ...creds })
    } else {
      onConfirm(null)
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-md flex-col overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="bg-brand-teal-deep grid size-11 shrink-0 place-items-center rounded-lg text-white">
            <BrandIcon provider={integration} className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-[10.5px] font-bold uppercase tracking-wider">
              {t('onboarding.connect_dialog.eyebrow')}
            </p>
            <h2 className="text-brand-navy text-lg font-bold tracking-tight">{providerName}</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-snug">{tagline}</p>
          </div>
        </div>

        <div className="bg-muted/30 border-border mt-4 rounded-lg border p-3">
          <p className="text-foreground mb-2 text-xs font-bold uppercase tracking-wider">
            {t('onboarding.connect_dialog.what_happens')}
          </p>
          <ul className="space-y-1.5">
            {steps
              .filter((s) => s)
              .map((s, i) => (
                <li key={i} className="text-foreground flex items-start gap-2 text-[13px]">
                  <span className="bg-brand-teal-deep mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
          </ul>
        </div>

        {/* T129 — Inline credentials форма. Заполнится в onConfirm callback. */}
        {fields.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-foreground text-xs font-bold uppercase tracking-wider">
              {t('onboarding.connect_dialog.credentials_label')}
            </p>
            {fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={`cred-${f.key}`} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={`cred-${f.key}`}
                  type={f.type}
                  value={creds[f.key] ?? ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                  autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                />
              </div>
            ))}
            <p className="text-muted-foreground text-[11px]">
              {t('onboarding.connect_dialog.credentials_hint')}
            </p>
          </div>
        ) : null}

        {hint ? <p className="text-muted-foreground mt-3 text-xs italic">{hint}</p> : null}

        {/* Для интеграций без credentials (OAuth-based: banking/IG/FB/WhatsApp/Telegram/iCal) */}
        {fields.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {t('onboarding.connect_dialog.oauth_note')}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} className="sm:order-1">
            <X className="size-4" strokeWidth={2} />
            {t('onboarding.connect_dialog.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={fields.length > 0 && !allRequiredFilled}
            className="sm:order-2"
            data-testid="onb-connect-confirm"
          >
            <Check className="size-4" strokeWidth={2.4} />
            {t('onboarding.connect_dialog.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
