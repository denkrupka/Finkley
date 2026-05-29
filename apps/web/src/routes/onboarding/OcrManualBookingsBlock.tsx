import { Camera } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { OcrNotebookButton, type ParsedVisit } from './OcrNotebookButton'

/**
 * Блок «Ведёшь резервации вручную? Загрузи фото журнала». Раньше жил в
 * Step3Services; перенесён в integrations_bookings шаг — это семантически
 * правильное место (вариант записи: Booksy / iCal / WhatsApp / OCR журнала).
 *
 * Карточка-приглашение + кнопка фото-аплоада. После OCR визиты добавляются
 * к state.ocr_visits и импортируются в visits таблицу при создании салона
 * (или сразу если early-create уже произошёл и salonId передан).
 */
export function OcrManualBookingsBlock({
  salonId,
  ocrVisits,
  onOcrVisitsAdded,
}: {
  salonId: string | null
  ocrVisits: ParsedVisit[]
  onOcrVisitsAdded: (visits: ParsedVisit[]) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 mt-4 flex flex-col gap-2 rounded-xl border-2 border-dashed p-4">
      <div className="flex items-start gap-2">
        <Camera className="text-brand-teal-deep mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-bold">{t('onboarding.step3.ocr_title')}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {t('onboarding.step3.ocr_body')}
          </p>
        </div>
      </div>
      <OcrNotebookButton
        salonId={salonId}
        onVisitsParsed={(v) => onOcrVisitsAdded([...ocrVisits, ...v])}
      />
      {ocrVisits.length > 0 ? (
        <p className="text-brand-teal-deep text-xs font-bold">
          {t('onboarding.step3.ocr_collected', { count: ocrVisits.length })}
        </p>
      ) : null}
    </div>
  )
}
