import type { LucideIcon } from 'lucide-react'

/**
 * Универсальный горизонтальный таб-навигатор для страниц-категорий
 * (Доходы / Отчёты / Финансы / Настройки). Идентичен по стилю
 * SettingsTabsNav / IntegrationsTabsNav.
 *
 * Активный таб контролируется родителем (обычно через URL search-param).
 */
export type PageTab<TId extends string> = {
  id: TId
  labelKey: string
  icon: LucideIcon
}

export function PageTabsNav<TId extends string>({
  tabs,
  active,
  onChange,
  t,
}: {
  tabs: PageTab<TId>[]
  active: TId
  onChange: (id: TId) => void
  /** i18n translator function — оставлен injectable чтобы избежать
   *  пересоздания этого компонента при каждой смене языка. */
  t: (key: string) => string
}) {
  return (
    <div
      className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-1.5 print:hidden"
      data-print-hide
    >
      <nav className="-mx-1.5 flex gap-1 overflow-x-auto px-1.5 sm:overflow-visible">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
            >
              <Icon className="size-4" strokeWidth={1.8} />
              {t(tab.labelKey)}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
