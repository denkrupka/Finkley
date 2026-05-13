import { useTranslation } from 'react-i18next'

/**
 * Заглушка для будущего helpdesk. Когда у нас появится таблица feedback /
 * bug_reports, добавим список с фильтрами и кнопкой «mark resolved».
 */
export function AdminFeedbackPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 flex-col p-5 sm:p-8">
      <div className="border-border bg-card shadow-finsm rounded-lg border p-8 text-center">
        <p className="text-brand-navy text-lg font-bold">{t('admin.feedback.title')}</p>
        <p className="text-muted-foreground mt-2 text-sm">{t('admin.feedback.empty')}</p>
        <p className="text-muted-foreground mt-1 text-xs">{t('admin.feedback.todo_note')}</p>
      </div>
    </div>
  )
}
