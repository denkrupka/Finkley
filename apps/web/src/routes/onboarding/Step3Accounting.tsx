import { Building2, FileText, Plug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils/cn'

import type { OnboardingIntegration } from './OnboardingPage'

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

type Props = {
  value: { nip: string; company_name: string }
  onChange: (v: { nip: string; company_name: string }) => void
  /** T107 — список выбранных интеграций бухгалтерии. Обработка как у других
   *  интеграций: после submit'a redirect в /settings/integrations?prompt=…. */
  selectedIntegrations?: OnboardingIntegration[]
  onToggleIntegration?: (id: OnboardingIntegration) => void
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
}: Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Building2 className="text-brand-teal-deep size-6" strokeWidth={2} />
          {t('onboarding.step_accounting.title', { defaultValue: 'Бухгалтерия' })}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {t('onboarding.step_accounting.subtitle', {
            defaultValue:
              'NIP + компания нужны для выписки фактур из портала. А интеграция с твоей бухгалтерской системой избавит от двойного ввода.',
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label
            htmlFor="ob-nip"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
          >
            {t('onboarding.step_accounting.nip_label', { defaultValue: 'NIP компании' })}
          </Label>
          <Input
            id="ob-nip"
            value={value.nip}
            onChange={(e) => onChange({ ...value, nip: e.target.value })}
            placeholder="5252123456"
            className="num"
            inputMode="numeric"
          />
          <p className="text-muted-foreground mt-1 text-xs">
            {t('onboarding.step_accounting.nip_hint', {
              defaultValue: 'По NIP автоматом подтянем название компании из MF White List.',
            })}
          </p>
        </div>
        <div>
          <Label
            htmlFor="ob-comp"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
          >
            {t('onboarding.step_accounting.company_label', { defaultValue: 'Название компании' })}
          </Label>
          <Input
            id="ob-comp"
            value={value.company_name}
            onChange={(e) => onChange({ ...value, company_name: e.target.value })}
            placeholder={t('onboarding.step_accounting.company_placeholder', {
              defaultValue: 'Salon ABC Sp. z o.o.',
            })}
          />
        </div>
      </div>

      {/* T107 — секция выбора провайдера бухгалтерии */}
      {onToggleIntegration ? (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 rounded-xl border-2 border-dashed p-4">
          <div className="mb-3 flex items-center gap-2">
            <Plug className="text-brand-teal-deep size-5" strokeWidth={2} />
            <p className="text-foreground text-sm font-bold">
              {t('onboarding.step_accounting.providers_title', {
                defaultValue: 'Подключить бухгалтерскую систему',
              })}
            </p>
          </div>
          <p className="text-muted-foreground mb-3 text-xs leading-snug">
            {t('onboarding.step_accounting.providers_subtitle', {
              defaultValue:
                'Отметь то что используешь — после создания салона мы откроем диалоги подключения. Можно подключить несколько.',
            })}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ACCOUNTING_PROVIDERS.map((p) => {
              const checked = selectedIntegrations.includes(p.id as OnboardingIntegration)
              return (
                <label
                  key={p.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors',
                    checked
                      ? 'border-brand-teal-deep bg-brand-teal-soft/40'
                      : 'border-border bg-card hover:bg-muted/30',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleIntegration(p.id as OnboardingIntegration)}
                    className="accent-brand-teal-deep mt-0.5 size-4 shrink-0 cursor-pointer"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-bold">{p.name}</p>
                    <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                      {p.description}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="border-brand-teal-soft bg-brand-teal-soft/30 flex items-start gap-3 rounded-md border p-4">
        <FileText className="text-brand-teal-deep mt-0.5 size-5 shrink-0" strokeWidth={2} />
        <div className="text-foreground text-[12.5px] leading-relaxed">
          <p className="font-semibold">
            {t('onboarding.step_accounting.integrations_note_title', {
              defaultValue: 'Зачем это нужно?',
            })}
          </p>
          <p className="text-muted-foreground mt-1">
            {t('onboarding.step_accounting.integrations_note_body', {
              defaultValue:
                'AI заберёт все твои выставленные/полученные фактуры и автоматически разнесёт по доходам/расходам. Никакого ручного ввода — twoja księgowa получит готовые данные.',
            })}
          </p>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        {t('onboarding.step_accounting.hint_skip', {
          defaultValue: 'Можно пропустить — добавишь в Настройки → Бухгалтерия позже.',
        })}
      </p>
    </div>
  )
}
