import { Building2, Check, Plug } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils/cn'

import { ConnectIntegrationDialog } from './ConnectIntegrationDialog'
import type { OnboardingIntegration, PendingCredentials } from './OnboardingPage'

type AccountingProvider = {
  id: 'wfirma' | 'ksef' | 'fakturownia' | 'ifirma' | 'infakt'
  name: string
  description: string
}

const ACCOUNTING_PROVIDERS: AccountingProvider[] = [
  {
    id: 'wfirma',
    name: 'wFirma',
    description:
      'Самая популярная в Польше. AI достаёт фактуры из inbox, расходы фиксируются сами.',
  },
  {
    id: 'ksef',
    name: 'KSeF (Krajowy System e-Faktur)',
    description:
      'Государственный реестр e-фактур. Обязательно для всех с 2026. Синхронизация — каждый час.',
  },
  {
    id: 'fakturownia',
    name: 'Fakturownia',
    description:
      'Простая выписка фактур. AI забирает все выставленные счета и связывает с визитами.',
  },
  {
    id: 'ifirma',
    name: 'iFirma',
    description: 'Облачная бухгалтерия. Подходит для JDG и Sp. z o.o.',
  },
  {
    id: 'infakt',
    name: 'inFakt',
    description: 'AI распознаёт сканы фактур, импорт PDF и e-фактур.',
  },
]

/** T138 — как ведёт бухгалтерию. */
export type AccountingMode = 'self' | 'biuro' | 'app' | 'none'

const ACCOUNTING_MODES: Array<{ id: AccountingMode; title: string; hint: string }> = [
  {
    id: 'self',
    title: 'Сам(а) веду',
    hint: 'JDG/самозанятый, делаю сам через wFirma / Fakturownia / iFirma.',
  },
  {
    id: 'biuro',
    title: 'Веду через бухгалтера / biuro',
    hint: 'Бухгалтер ведёт всё, я просто отправляю чеки и фактуры.',
  },
  {
    id: 'app',
    title: 'Через приложение / онлайн-сервис',
    hint: 'inFakt, KSeF или другой облачный сервис со своим интерфейсом.',
  },
  {
    id: 'none',
    title: 'Пока никак',
    hint: 'Только начинаю — заведу позже в Настройках.',
  },
]

type Props = {
  value: { nip: string; company_name: string }
  onChange: (v: { nip: string; company_name: string }) => void
  /** T107 — список выбранных интеграций бухгалтерии. Обработка как у других
   *  интеграций: после submit'a redirect в /settings/integrations?prompt=…. */
  selectedIntegrations?: OnboardingIntegration[]
  onToggleIntegration?: (id: OnboardingIntegration) => void
  /** T138 — как ведёт бухгалтерию. По выбору фильтруем релевантных провайдеров. */
  accountingMode?: AccountingMode
  onAccountingModeChange?: (mode: AccountingMode) => void
  /** T129 — credentials per provider. */
  credentials?: Partial<Record<OnboardingIntegration, PendingCredentials>>
  onCredentialsChange?: (id: OnboardingIntegration, creds: PendingCredentials | null) => void
}

/**
 * T107 — Step3Accounting расширен:
 *   - NIP + название компании (обязательны для фактур).
 *   - Inline-секция «Подключить бухгалтерию» с 5 провайдерами (wFirma,
 *     KSeF, Fakturownia, iFirma, inFakt) — чекбоксы. После submit'a
 *     OnboardingPage откроет нужные диалоги в /settings/integrations.
 */
export function Step3Accounting({
  value,
  onChange,
  selectedIntegrations = [],
  onToggleIntegration,
  accountingMode,
  onAccountingModeChange,
  credentials,
  onCredentialsChange,
}: Props) {
  const { t } = useTranslation()
  // T122 — модалка подключения провайдера бухгалтерии при клике.
  const [pendingProvider, setPendingProvider] = useState<OnboardingIntegration | null>(null)
  // T138 — провайдеры показываем только если юзер выбрал self/app — иначе
  // бухгалтер всё ведёт сам в biuro или ничего пока нет.
  const showProviders = accountingMode === 'self' || accountingMode === 'app'

  // T177+T224 — при переключении на biuro/none снимаем уже-выбранных
  // провайдеров бухгалтерии чтобы не было «invisible badge» (selected
  // но карточка скрыта) И очищаем pending_credentials через
  // onCredentialsChange(id, null) — иначе credentials уйдут в localStorage
  // при submit и pre-fill для dialog'а который юзер уже скрыл.
  function handleModeChange(mode: AccountingMode) {
    onAccountingModeChange?.(mode)
    if (mode === 'biuro' || mode === 'none') {
      for (const p of ACCOUNTING_PROVIDERS) {
        const id = p.id as OnboardingIntegration
        if (selectedIntegrations.includes(id)) {
          onToggleIntegration?.(id)
        }
        onCredentialsChange?.(id, null)
      }
    }
  }

  function handleProviderClick(id: OnboardingIntegration) {
    if (selectedIntegrations.includes(id)) onToggleIntegration?.(id)
    else setPendingProvider(id)
  }

  return (
    <div className="space-y-3">
      <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Building2 className="text-brand-teal-deep size-6" strokeWidth={2} />
        {t('onboarding.step_accounting.title')}
      </h2>

      {/* T138 — как ведёшь бухгалтерию (радио). */}
      {onAccountingModeChange ? (
        <div className="flex flex-col gap-2">
          <Label className="block text-xs font-semibold uppercase tracking-wider">
            {t('onboarding.step_accounting.mode_label')}
          </Label>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {ACCOUNTING_MODES.map((m) => {
              const checked = accountingMode === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleModeChange(m.id)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-md border-2 p-2.5 text-left transition-colors',
                    checked
                      ? 'border-brand-teal-deep bg-brand-teal-soft/40'
                      : 'border-border bg-card hover:bg-muted/30',
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
                      checked
                        ? 'border-brand-teal-deep bg-brand-teal-deep'
                        : 'border-border bg-card',
                    )}
                  >
                    {checked ? <div className="size-1.5 rounded-full bg-white" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-bold">{m.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">{m.hint}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label
            htmlFor="ob-nip"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
          >
            {t('onboarding.step_accounting.nip_label')}
          </Label>
          <Input
            id="ob-nip"
            value={value.nip}
            onChange={(e) => onChange({ ...value, nip: e.target.value })}
            placeholder="5252123456"
            className="num"
            inputMode="numeric"
          />
        </div>
        <div>
          <Label
            htmlFor="ob-comp"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
          >
            {t('onboarding.step_accounting.company_label')}
          </Label>
          <Input
            id="ob-comp"
            value={value.company_name}
            onChange={(e) => onChange({ ...value, company_name: e.target.value })}
            placeholder={t('onboarding.step_accounting.company_placeholder')}
          />
        </div>
      </div>

      {/* T107/T138 — провайдеры бухгалтерии показываются только при self/app. */}
      {onToggleIntegration && showProviders ? (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 rounded-xl border-2 border-dashed p-3">
          <div className="mb-2 flex items-center gap-2">
            <Plug className="text-brand-teal-deep size-5" strokeWidth={2} />
            <p className="text-foreground text-sm font-bold">
              {t('onboarding.step_accounting.providers_title')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {ACCOUNTING_PROVIDERS.map((p) => {
              const id = p.id as OnboardingIntegration
              const checked = selectedIntegrations.includes(id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderClick(id)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
                    checked
                      ? 'border-brand-teal-deep bg-brand-teal-soft/40'
                      : 'border-border bg-card hover:bg-muted/30',
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded',
                      checked ? 'bg-brand-teal-deep text-white' : 'border-border bg-card border',
                    )}
                  >
                    {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-bold">{p.name}</p>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">
                      {p.description}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <ConnectIntegrationDialog
        integration={pendingProvider}
        open={pendingProvider !== null}
        onClose={() => setPendingProvider(null)}
        existingCredentials={pendingProvider ? credentials?.[pendingProvider] : undefined}
        onConfirm={(creds) => {
          if (pendingProvider) {
            onToggleIntegration?.(pendingProvider)
            onCredentialsChange?.(pendingProvider, creds)
          }
        }}
      />
    </div>
  )
}
