import { Bug, FlaskConical } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMyProfile } from '@/hooks/useMyProfile'

// Лениво — html2canvas-pro весит ~80KB. Грузим только когда тестер откроет модалку.
const TesterBugModal = lazy(() =>
  import('./TesterBugModal').then((m) => ({ default: m.TesterBugModal })),
)

/**
 * Желтая фиксированная панель сверху для пользователей с profiles.is_tester=true.
 *
 * Виден внутри SalonLayout (на любой salon-странице). Снаружи салона (на
 * /admin, /onboarding, гостевых страницах) не рендерится — там тестировать
 * нечего, а ширину/layout не хочется ломать.
 *
 * Кнопка «Сообщить о баге» открывает модалку с описанием/файлом/скриншотом.
 */
export function TesterBanner() {
  const { t } = useTranslation()
  const { data: profile } = useMyProfile()
  const [open, setOpen] = useState(false)

  if (!profile?.is_tester) return null

  return (
    <>
      {/* z-[60] — выше Radix popover (z-50) и mobile Dialog overlay (z-40/50),
          чтобы баннер «Тестировщик» всегда висел сверху даже когда открыт
          dropdown языков, нотификаций, или sidebar-drawer на мобиле. */}
      <div className="sticky top-0 z-[60] flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-900 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <FlaskConical className="size-4 shrink-0" strokeWidth={2} />
          <p className="truncate text-xs font-semibold sm:text-sm">{t('tester.banner.text')}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-amber-700"
        >
          <Bug className="size-3.5" strokeWidth={2} />
          {t('tester.banner.button')}
        </button>
      </div>

      {open ? (
        <Suspense fallback={null}>
          <TesterBugModal onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
