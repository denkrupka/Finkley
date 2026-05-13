import { BarChart3, Building2, FileText, MessageSquare, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

import { useIsAppAdmin } from '@/hooks/useMediaPosts'

/**
 * Layout для всех страниц супер-админ панели (/admin/...). Доступ только
 * пользователям из таблицы app_admins. Salon-admins (роли в salon_members)
 * сюда не пускаются.
 */
export function AdminLayout() {
  const { t } = useTranslation()
  const { data: isAdmin, isLoading } = useIsAppAdmin()

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </div>
    )
  }
  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-foreground text-lg font-bold">{t('admin.no_access_title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('admin.no_access_body')}</p>
      </div>
    )
  }

  const NAV = [
    { to: 'overview', label: 'admin.nav.overview', icon: BarChart3 },
    { to: 'salons', label: 'admin.nav.salons', icon: Building2 },
    { to: 'users', label: 'admin.nav.users', icon: Users },
    { to: 'media', label: 'admin.nav.media', icon: FileText },
    { to: 'feedback', label: 'admin.nav.feedback', icon: MessageSquare },
  ]

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-border bg-card border-b px-5 py-3 sm:px-8">
        <h1 className="text-brand-navy text-lg font-bold">{t('admin.title')}</h1>
        <p className="text-muted-foreground text-xs">{t('admin.subtitle')}</p>
      </div>
      <nav className="border-border flex gap-1 overflow-x-auto border-b px-5 sm:px-8">
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                [
                  'text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 border-b-2 border-transparent px-2 py-3 text-sm font-semibold transition-colors',
                  isActive ? '!border-primary !text-primary' : '',
                ].join(' ')
              }
            >
              <Icon className="size-4" strokeWidth={1.7} />
              {t(item.label)}
            </NavLink>
          )
        })}
      </nav>
      <Outlet />
    </div>
  )
}
