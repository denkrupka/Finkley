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
  /** Опциональный unread badge — число справа в красном кружке.
   *  Передавай undefined/0 чтобы не показывать. */
  badge?: number
}

export function PageTabsNav<TId extends string>({
  tabs,
  active,
  onChange,
  t,
  rightSlot,
  wrap = false,
  size = 'md',
}: {
  tabs: PageTab<TId>[]
  active: TId
  onChange: (id: TId) => void
  /** i18n translator function — оставлен injectable чтобы избежать
   *  пересоздания этого компонента при каждой смене языка. */
  t: (key: string) => string
  /** Опциональный контент справа от вкладок (например, action-кнопки
   *  типа Импорт CSV / Список / Календарь на странице Доходы). */
  rightSlot?: React.ReactNode
  /** Если true — табы переносятся на новую строку, без горизонтального
   *  скролла. Используется когда вкладок 6+ (Image #60 Финансы → Параметры). */
  wrap?: boolean
  /** 'md' — стандарт; 'sm' — ужатые табы (px+text), помогает влезать
   *  большему количеству вкладок в одну строку (Image #60). */
  size?: 'md' | 'sm'
}) {
  const navClass = wrap
    ? '-mx-1.5 flex flex-1 flex-wrap gap-1 px-1.5'
    : '-mx-1.5 flex flex-1 gap-1 overflow-x-auto px-1.5 sm:overflow-visible'
  const tabPad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4'
  return (
    <div
      className="border-border bg-card shadow-finsm mb-6 flex items-center gap-2 rounded-lg border p-1.5 print:hidden"
      data-print-hide
    >
      <nav className={navClass}>
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`flex shrink-0 items-center gap-2 rounded-md font-semibold transition-colors ${tabPad} ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
            >
              <Icon className={iconSize} strokeWidth={1.8} />
              {t(tab.labelKey)}
              {tab.badge && tab.badge > 0 ? (
                <span
                  className={`bg-destructive text-destructive-foreground inline-flex items-center justify-center rounded-full ${
                    size === 'sm'
                      ? 'min-w-[18px] px-1.5 text-[10px]'
                      : 'min-w-[20px] px-2 text-[11px]'
                  } font-bold leading-tight`}
                >
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>
      {rightSlot ? <div className="flex shrink-0 items-center gap-2">{rightSlot}</div> : null}
    </div>
  )
}
