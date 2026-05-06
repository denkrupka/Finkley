import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * FAB «+ Визит». На desktop — pill снизу справа (referенс `chrome.jsx` → `FAB`).
 * На mobile — круглая кнопка над bottom-nav (`MobileDashboard`).
 *
 * Реальный обработчик откроет модалку Quick Entry в TASK-10. Сейчас onClick — proxy.
 */
export function FAB({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      {/* Desktop pill */}
      <button
        type="button"
        onClick={onClick}
        className="bg-primary font-display text-primary-foreground shadow-finlg fixed bottom-7 right-7 z-20 hidden h-14 items-center gap-2 rounded-full px-5 pl-[18px] text-[15px] font-semibold lg:inline-flex"
        data-testid="fab-add-visit-desktop"
      >
        <Plus className="size-5" strokeWidth={2.4} />
        <span>{t('visits.fab_label')}</span>
      </button>

      {/* Mobile round, чуть выше bottom-nav */}
      <button
        type="button"
        onClick={onClick}
        className="bg-primary text-primary-foreground shadow-finlg fixed bottom-20 right-5 z-20 grid size-14 place-items-center rounded-full lg:hidden"
        aria-label={t('visits.fab_label')}
        data-testid="fab-add-visit-mobile"
      >
        <Plus className="size-6" strokeWidth={2.4} />
      </button>
    </>
  )
}
