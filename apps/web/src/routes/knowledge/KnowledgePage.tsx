import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * /{salonId}/knowledge — база знаний салона (стадия 5).
 *
 * Idea: внутренний wiki: SOP-ы (стандартные операционные процедуры),
 * рецепты окрашивания, правила скидок, чек-листы открытия/закрытия,
 * шаблоны общения с клиентами. Каждый сотрудник видит то что ему
 * по роли (staff видит инструкции для своей специализации, не финансы).
 *
 * Сейчас — placeholder, ждёт первых юзеров с реальной потребностью.
 */
export function KnowledgePage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-7 sm:px-8">
      <div className="border-border bg-card shadow-finsm w-full max-w-lg rounded-lg border p-8 text-center">
        <div className="bg-brand-teal-soft text-brand-teal-deep mx-auto mb-4 grid size-14 place-items-center rounded-2xl">
          <BookOpen className="size-7" strokeWidth={1.7} />
        </div>
        <h1 className="text-brand-navy mb-2 text-xl font-bold tracking-tight">
          {t('knowledge.title')}
        </h1>
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          {t('knowledge.subtitle')}
        </p>
        <p className="text-brand-text-faint text-xs">{t('knowledge.coming_soon')}</p>
      </div>
    </div>
  )
}
