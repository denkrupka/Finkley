import {
  Banknote,
  FileText,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Plug,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CATEGORY_ORDER, getCategoryLabel, type IntegrationCategory } from './integrations-config'

const TAB_ICONS: Record<IntegrationCategory, LucideIcon> = {
  accounting: FileText,
  booking: Plug,
  banking: Banknote,
  messengers: MessageCircle,
  sms: MessageSquare,
  other: MoreHorizontal,
}

/**
 * Горизонтальный таб-навигатор для страницы /integrations. По стилю
 * идентичен `SettingsTabsNav` — белая капсула с табами, активный таб
 * с тёмным фоном. Скроллится на мобиле.
 */
export function IntegrationsTabsNav({
  active,
  onChange,
}: {
  active: IntegrationCategory
  onChange: (cat: IntegrationCategory) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-1.5">
      <nav className="-mx-1.5 flex gap-1 overflow-x-auto px-1.5 sm:overflow-visible">
        {CATEGORY_ORDER.map((cat) => {
          const Icon = TAB_ICONS[cat]
          const isActive = active === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onChange(cat)}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
            >
              <Icon className="size-4" strokeWidth={1.8} />
              {t(getCategoryLabel(cat))}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
