import { ArrowRight, Lock, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { PLAN_PRICE_EUR, upgradeTargetForSection, type SectionId } from '@/lib/entitlements'

/** Outcome-фрейминг выгоды для каждой запертой секции (не «фича», а результат). */
const SECTION_BENEFIT: Record<SectionId, string> = {
  expenses: 'Подключите расходы — и увидите не оборот, а реальную прибыль.',
  reports: 'Откройте отчёты — поймёте, какие услуги и мастера реально приносят деньги.',
  messenger:
    'Подключите мессенджер — отвечайте клиентам из Instagram, Facebook и Telegram в одном окне.',
  marketing: 'Включите маркетинг — превращайте разовых клиентов в постоянных и считайте отдачу.',
  ai: 'Включите AI — получайте советы по прибыли на реальных цифрах вашего салона.',
  finance: 'Откройте финансы — P&L, денежный поток и счета на оплату без единой таблицы.',
  inventory: 'Подключите склад — контролируйте расход материалов и их влияние на маржу.',
  dashboard: '',
  income: '',
  settings: '',
}

/**
 * Плашка-пейволл для секции, недоступной на текущем тарифе (T7).
 *
 * Секция остаётся в навигации (активна), но при переходе показывается это
 * вместо контента. CTA ведёт на правильный для секции тариф и фреймит выгоду,
 * а не фичу.
 */
export function UpgradeOverlay({ section }: { section: SectionId }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { salonId } = useParams<{ salonId: string }>()

  const target = upgradeTargetForSection(section)
  const price = PLAN_PRICE_EUR[target]
  const sectionName = t(`nav.${section}`)

  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-5 py-12">
      <div className="border-border bg-card shadow-finlg w-full max-w-md rounded-2xl border p-8 text-center">
        <div className="bg-brand-teal-soft/40 text-brand-teal-deep mx-auto grid size-14 place-items-center rounded-full">
          <Lock className="size-7" strokeWidth={2} />
        </div>
        <h2 className="text-brand-navy mt-5 text-xl font-extrabold tracking-tight">
          {t('billing.upgrade.locked_title', {
            section: sectionName,
            defaultValue: '«{{section}}» недоступно на вашем тарифе',
          })}
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          {SECTION_BENEFIT[section] ||
            t('billing.upgrade.generic_benefit', {
              defaultValue: 'Перейдите на платный тариф, чтобы открыть этот раздел.',
            })}
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => navigate(`/${salonId}/settings?tab=billing&plan=${target}`)}
            className="bg-brand-navy hover:bg-brand-navy/90 inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-bold text-white transition-colors"
          >
            <Sparkles className="size-4" strokeWidth={2.2} />
            {t('billing.upgrade.cta', {
              price,
              defaultValue: 'Перейти на €{{price}}',
            })}
            <ArrowRight className="size-4" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => navigate(`/${salonId}/settings?tab=billing`)}
            className="text-brand-teal-deep hover:text-brand-teal inline-flex h-9 items-center justify-center text-sm font-semibold"
          >
            {t('billing.upgrade.compare', { defaultValue: 'Сравнить тарифы' })}
          </button>
        </div>
      </div>
    </div>
  )
}
