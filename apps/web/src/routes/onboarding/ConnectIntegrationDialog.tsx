import { Check, Plug, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'

import type { OnboardingIntegration } from './OnboardingPage'

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
const META: Record<
  OnboardingIntegration,
  { name: string; tagline: string; steps: string[]; provider_hint?: string }
> = {
  booksy: {
    name: 'Booksy',
    tagline: 'Календарь визитов, мастера, клиенты — всё попадёт в портал автоматом.',
    steps: [
      'Вход в свой Booksy (email + пароль)',
      'Импорт всех визитов, мастеров и клиентов',
      'Финансы считаются автоматически каждый день',
    ],
    provider_hint: 'Нужны email и пароль от Booksy (мы шифруем и не показываем повторно).',
  },
  wfirma: {
    name: 'wFirma',
    tagline: 'Все фактуры из inbox — в расходы и доходы автоматом.',
    steps: [
      'Авторизация через wFirma API',
      'AI забирает все выставленные и полученные фактуры',
      'Расходы по контрагентам — без ручного ввода',
    ],
    provider_hint: 'Нужны email + пароль от wFirma + appKey (его выдаём мы).',
  },
  banking: {
    name: 'Банковский счёт (PSD2)',
    tagline: 'Каждое списание автоматом упадёт в раздел «Расходы».',
    steps: [
      'Выбор банка из списка (mBank, ING, PKO, Santander, …)',
      'Безопасный консент через банк-приложение',
      'Чтение операций за 90 дней без переподключения',
    ],
    provider_hint: 'Подключение через Enable Banking — мы видим только чтение.',
  },
  instagram: {
    name: 'Instagram Direct',
    tagline: 'DM-сообщения клиентов попадают в портал. AI отвечает на типовые вопросы.',
    steps: [
      'Авторизация через Facebook Business',
      'Выбор Instagram аккаунта салона',
      'AI отвечает на цены/расписание автоматом',
    ],
  },
  facebook: {
    name: 'Facebook Messenger',
    tagline: 'Все сообщения от клиентов — в одну ленту с Instagram и Telegram.',
    steps: ['Авторизация через Facebook', 'Выбор страницы салона', 'Подписка на webhook-сообщения'],
  },
  telegram: {
    name: 'Telegram',
    tagline: 'AI-инсайты и алерты прямо в Telegram. Каждое утро в 9:00 — разбор дня.',
    steps: [
      'Получишь deep-link к боту @finkley_tg_bot',
      'Один клик — и привязка готова',
      'Утренний разбор + критичные алерты',
    ],
  },
  ical: {
    name: 'iCal-фид',
    tagline: 'Каждый мастер подпишется на свой календарь визитов в любом телефоне.',
    steps: [
      'Сгенерируем приватный iCal URL для каждого мастера',
      'Мастер добавляет в Google/Apple/Outlook Calendar',
      'Визиты синхронизируются автоматом',
    ],
  },
  ocr_notebook: {
    name: 'Фото блокнота → AI',
    tagline: 'AI распознаёт рукописные записи. Никакого ручного ввода истории.',
    steps: [
      'Сфотографируешь страницы блокнота',
      'AI распознает дату, клиента, услугу, сумму',
      'Подтвердишь — визиты попадут в портал',
    ],
  },
  ksef: {
    name: 'KSeF (Krajowy System e-Faktur)',
    tagline: 'Государственный реестр e-фактур. Обязательно для всех с 2026.',
    steps: [
      'Подключение через сертификат компании',
      'Синхронизация фактур каждый час',
      'Полное соответствие требованиям Министерства финансов',
    ],
  },
  fakturownia: {
    name: 'Fakturownia',
    tagline: 'AI забирает все выставленные счета и связывает с визитами.',
    steps: ['API-токен Fakturownia', 'Sync счетов каждые 6 часов', 'Связь счёт↔клиент автоматом'],
  },
  ifirma: {
    name: 'iFirma',
    tagline: 'Облачная бухгалтерия для JDG и Sp. z o.o.',
    steps: [
      'Email + пароль iFirma',
      'Импорт всех фактур и расходов',
      'Автоматическая разноска по категориям',
    ],
  },
  infakt: {
    name: 'inFakt',
    tagline: 'AI распознаёт сканы фактур, импорт PDF и e-фактур.',
    steps: ['API-токен inFakt', 'Sync фактур каждые 6 часов', 'PDF и e-фактуры'],
  },
}

export function ConnectIntegrationDialog({
  integration,
  open,
  onClose,
  onConfirm,
}: {
  integration: OnboardingIntegration | null
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  if (!integration) return null
  const meta = META[integration]

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <div className="flex items-start gap-3">
          <div className="bg-brand-teal-deep grid size-11 shrink-0 place-items-center rounded-lg text-white">
            <Plug className="size-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-[10.5px] font-bold uppercase tracking-wider">
              {t('onboarding.connect_dialog.eyebrow', { defaultValue: 'Подключение' })}
            </p>
            <h2 className="text-brand-navy text-lg font-bold tracking-tight">{meta.name}</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-snug">{meta.tagline}</p>
          </div>
        </div>

        <div className="bg-muted/30 border-border mt-4 rounded-lg border p-3">
          <p className="text-foreground mb-2 text-xs font-bold uppercase tracking-wider">
            {t('onboarding.connect_dialog.what_happens', { defaultValue: 'Что произойдёт' })}
          </p>
          <ul className="space-y-1.5">
            {meta.steps.map((s, i) => (
              <li key={i} className="text-foreground flex items-start gap-2 text-[13px]">
                <span className="bg-brand-teal-deep mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        {meta.provider_hint ? (
          <p className="text-muted-foreground mt-3 text-xs italic">{meta.provider_hint}</p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} className="sm:order-1">
            <X className="size-4" strokeWidth={2} />
            {t('onboarding.connect_dialog.cancel', { defaultValue: 'Отмена' })}
          </Button>
          <Button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className="sm:order-2"
            data-testid="onb-connect-confirm"
          >
            <Check className="size-4" strokeWidth={2.4} />
            {t('onboarding.connect_dialog.confirm', { defaultValue: 'Подключить' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
