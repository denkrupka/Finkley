import {
  BarChart3,
  Building2,
  FileText,
  LogOut,
  MessageSquare,
  MousePointerClick,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { useIsAppAdmin } from '@/hooks/useMediaPosts'
import { useMySalons } from '@/hooks/useSalons'
import { supabase } from '@/lib/supabase/client'

/**
 * Layout для super-admin панели — **корневой** роут `/admin/*`, без привязки
 * к salon. Доступ только пользователям из app_admins. Если у админа есть и
 * свои салоны — есть кнопка «В кабинет салона» (переключение в режим owner).
 *
 * Свой собственный chrome (header + tabs) — не использует SalonLayout.
 */
export function AdminLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: isAdmin, isLoading } = useIsAppAdmin()
  const { data: salons } = useMySalons()
  const ownSalon = salons?.[0]

  if (isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="bg-muted size-10 animate-pulse rounded-md" aria-hidden />
      </div>
    )
  }
  if (!isAdmin) {
    return (
      <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <ShieldCheck className="text-muted-foreground size-12" strokeWidth={1.2} />
        <h1 className="text-foreground text-xl font-bold">{t('admin.no_access_title')}</h1>
        <p className="text-muted-foreground max-w-md text-sm">{t('admin.no_access_body')}</p>
        <Link to="/" className="text-primary mt-2 text-sm font-semibold underline">
          {t('admin.no_access_back')}
        </Link>
      </div>
    )
  }

  const NAV = [
    { to: 'overview', label: 'admin.nav.overview', icon: BarChart3 },
    { to: 'salons', label: 'admin.nav.salons', icon: Building2 },
    { to: 'users', label: 'admin.nav.users', icon: Users },
    { to: 'media', label: 'admin.nav.media', icon: FileText },
    { to: 'feedback', label: 'admin.nav.feedback', icon: MessageSquare },
    { to: 'tracking', label: 'admin.nav.tracking', icon: MousePointerClick },
  ]

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="bg-background flex min-h-screen flex-col">
      {/* Header — узкая полоска чтобы отличить от салонских страниц */}
      <header className="border-border bg-brand-navy dark:bg-brand-navy-soft flex items-center justify-between border-b px-5 py-3 text-white sm:px-8">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-5" strokeWidth={1.8} />
          <div>
            <h1 className="text-base font-bold leading-tight">{t('admin.title')}</h1>
            <p className="text-[11px] leading-tight text-white/60">{t('admin.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {ownSalon ? (
            <Link
              to={`/${ownSalon.id}/dashboard`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/20 px-3 text-xs font-semibold text-white hover:bg-white/10"
            >
              {t('admin.back_to_salon', { name: ownSalon.name })}
            </Link>
          ) : null}
          <span className="hidden text-xs text-white/70 sm:inline">{user?.email}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex size-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10"
            title={t('admin.sign_out')}
            aria-label={t('admin.sign_out')}
          >
            <LogOut className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* Tabs nav */}
      <nav className="border-border bg-card flex gap-1 overflow-x-auto border-b px-5 sm:px-8">
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

      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
