import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function Step3Accounting({
  value,
  onChange,
}: {
  value: { nip: string; company_name: string }
  onChange: (v: { nip: string; company_name: string }) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('onboarding.step_accounting.title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {t('onboarding.step_accounting.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <p className="text-muted-foreground mt-1 text-xs">
            {t('onboarding.step_accounting.nip_hint')}
          </p>
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

      <div className="border-brand-teal-soft bg-brand-teal-soft/30 flex items-start gap-3 rounded-md border p-4">
        <FileText className="text-brand-teal-deep mt-0.5 size-5 shrink-0" strokeWidth={2} />
        <div className="text-foreground text-[12.5px] leading-relaxed">
          <p className="font-semibold">{t('onboarding.step_accounting.integrations_note_title')}</p>
          <p className="text-muted-foreground mt-1">
            {t('onboarding.step_accounting.integrations_note_body')}
          </p>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">{t('onboarding.step_accounting.hint_skip')}</p>
    </div>
  )
}
