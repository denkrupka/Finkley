import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Заглушка для разделов, которые в стадии 1 ещё не реализованы
 * (Клиенты, Отчёты, AI). Sidebar показывает все 8 пунктов прототипа,
 * но переход в эти разделы ведёт сюда.
 */
export function ComingSoon({
  icon: Icon,
  title,
  stage,
}: {
  icon: LucideIcon
  title: string
  stage: number
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-12 text-center">
      <div className="bg-accent text-accent-foreground grid size-16 place-items-center rounded-lg">
        <Icon className="size-8" strokeWidth={1.7} aria-hidden />
      </div>
      <div className="max-w-md">
        <h2 className="text-brand-navy text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-muted-foreground mt-2 text-sm">{t('coming_soon.subtitle', { stage })}</p>
      </div>
      <span className="border-border bg-card text-muted-foreground rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide">
        {t('coming_soon.badge', { stage })}
      </span>
    </div>
  )
}
