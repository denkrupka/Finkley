import { Bug, ChevronsLeft, ChevronsRight, HelpCircle } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'

import { LogoLockup } from '@/components/ui/logo'
import { ReferralButton } from '@/components/ui/ReferralButton'
import { ThemeToggleButton } from '@/components/ui/ThemeToggleButton'
import { useUnreadMessengerCount } from '@/hooks/useMessenger'
import { usePermissions } from '@/hooks/usePermissions'
import { useUnreadReviewsBySource } from '@/hooks/useReviews'
import { cn } from '@/lib/utils/cn'
import { NAV_ITEMS } from './nav-config'

/** Лениво — html2canvas-pro весит ~80KB, грузим только когда юзер откроет. */
const TesterBugModal = lazy(() =>
  import('@/components/tester/TesterBugModal').then((m) => ({ default: m.TesterBugModal })),
)

type Props = {
  salonId: string
  /** Для mobile-drawer — закрыть после клика по пункту */
  onNavigate?: () => void
  /** bug 94dd5f53 — collapsed mode: только иконки, ширина 64px. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

/**
 * Sidebar 232×fullheight (или 64×fullheight в collapsed). Sticky на
 * десктопе — всегда видна при прокрутке. Сверху лого, по центру навигация,
 * в подвале — Help / Реферал / Тема + кнопка collapse (bug 94dd5f53).
 */
export function Sidebar({ salonId, onNavigate, collapsed = false, onToggleCollapsed }: Props) {
  const { t } = useTranslation()
  const [bugOpen, setBugOpen] = useState(false)
  // Раньше показывали только негативные внешние отзывы. Юзер 02.06: «при
  // новом отзыве показывай тег на левой панели в Отчёты». То есть ВСЕ
  // непрочитанные (internal + external, любой rating).
  const { data: unreadReviewsBySource } = useUnreadReviewsBySource(salonId)
  const unreadNegative = unreadReviewsBySource?.total ?? 0
  const { data: unreadMessenger = 0 } = useUnreadMessengerCount(salonId)
  // T35 — фильтр nav-пунктов по permissions матрице. Главная и Настройки
  // всегда видны (минимально нужны юзеру даже с самыми ограниченными правами).
  const { can, role } = usePermissions(salonId)
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'dashboard' || item.id === 'settings') return true
    return can(item.id, 'view')
  })
  // Bug (баг-трекер): мастер (staff) видел блок «бонус за приглашённого друга».
  // Реферал — owner-инструмент, прячем для staff/external.
  const showReferral = role !== 'staff' && role !== 'external'

  return (
    <aside
      data-tour="sidebar"
      className={cn(
        // h-full (а не h-screen): родитель — fixed inset-y-0, его высота уже
        // равна видимой области. h-screen (100vh) на планшете/мобиле больше
        // видимой высоты → футер («Сообщить о баге» и пр.) уходил за экран и
        // не доставался скроллом. С h-full nav скроллится при нужде, футер
        // всегда виден (задача 11).
        'border-border bg-card flex h-full flex-shrink-0 flex-col border-r pb-4 pt-5 transition-all',
        collapsed ? 'w-[64px] px-2' : 'w-[232px] px-3.5',
      )}
    >
      {/* Logo + кнопка сворачивания. T28 — кнопка перенесена снизу наверх к
          логотипу, чтобы не занимать место в подвале. Использует ChevronsLeft/
          ChevronsRight (двойную стрелку) как компактный визуальный маркер. */}
      <div
        className={cn(
          'mb-5 flex items-center',
          collapsed ? 'flex-col gap-2' : 'justify-between px-2',
        )}
      >
        {collapsed ? <LogoLockup size={28} hideText /> : <LogoLockup size={28} />}
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={
              collapsed
                ? t('nav.expand_sidebar', { defaultValue: 'Развернуть меню' })
                : t('nav.collapse_sidebar', { defaultValue: 'Свернуть меню' })
            }
            aria-label={
              collapsed
                ? t('nav.expand_sidebar', { defaultValue: 'Развернуть меню' })
                : t('nav.collapse_sidebar', { defaultValue: 'Свернуть меню' })
            }
            className="text-muted-foreground hover:text-foreground hover:bg-accent/40 grid size-7 shrink-0 place-items-center rounded-md"
          >
            {collapsed ? (
              <ChevronsRight className="size-4" strokeWidth={1.8} />
            ) : (
              <ChevronsLeft className="size-4" strokeWidth={1.8} />
            )}
          </button>
        ) : null}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {visibleNavItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.id}
              to={`/${salonId}/${item.id}`}
              onClick={onNavigate}
              title={collapsed ? t(item.i18nKey) : undefined}
              data-tour-nav={item.id}
              className={({ isActive }) =>
                cn(
                  'flex items-center rounded-md text-sm transition-colors',
                  collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-foreground hover:bg-accent/50 font-medium',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      'size-[18px] shrink-0',
                      isActive ? 'text-primary-foreground' : 'text-muted-foreground',
                    )}
                    strokeWidth={1.7}
                  />
                  {collapsed ? null : <span className="flex-1">{t(item.i18nKey)}</span>}
                  {/* В collapsed badge показываем как маленькую red-dot
                      в углу иконки (через absolute, требует relative parent) */}
                  {item.id === 'reports' && unreadNegative > 0 ? (
                    collapsed ? (
                      <span
                        className="bg-destructive absolute -mr-3 -mt-3 size-2 rounded-full"
                        title={t('nav.reports_unread_negative', { count: unreadNegative })}
                      />
                    ) : (
                      <span
                        className={cn(
                          'inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none',
                          isActive
                            ? 'bg-primary-foreground text-primary'
                            : 'bg-destructive text-destructive-foreground',
                        )}
                        title={t('nav.reports_unread_negative', { count: unreadNegative })}
                      >
                        {unreadNegative > 99 ? '99+' : unreadNegative}
                      </span>
                    )
                  ) : null}
                  {item.id === 'messenger' && unreadMessenger > 0 ? (
                    collapsed ? (
                      <span
                        className="bg-destructive absolute -mr-3 -mt-3 size-2 rounded-full"
                        title={t('nav.messenger_unread', { count: unreadMessenger })}
                      />
                    ) : (
                      <span
                        className={cn(
                          'inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none',
                          isActive
                            ? 'bg-primary-foreground text-primary'
                            : 'bg-destructive text-destructive-foreground',
                        )}
                        title={t('nav.messenger_unread', { count: unreadMessenger })}
                      >
                        {unreadMessenger > 99 ? '99+' : unreadMessenger}
                      </span>
                    )
                  ) : null}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer: реферал + «Сообщить о баге» + тема + help. Кнопка-баг —
          между ReferralButton и Help. Раньше эта кнопка жила только в
          жёлтой ленте Tester'а (TesterBanner) и была доступна только
          тестерам; теперь — всем юзерам по запросу владельца. */}
      <div className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
        {collapsed || !showReferral ? null : <ReferralButton variant="sidebar" />}
        <button
          type="button"
          onClick={() => setBugOpen(true)}
          title={collapsed ? t('nav.report_bug') : undefined}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-amber-500/15 text-[12px] font-semibold text-amber-900 transition-colors hover:bg-amber-500/25 dark:bg-amber-400/20 dark:text-amber-100 dark:hover:bg-amber-400/30',
            collapsed ? 'w-9 px-0' : 'px-2',
          )}
        >
          <Bug className="size-3.5" strokeWidth={2} />
          {collapsed ? null : t('nav.report_bug')}
        </button>
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1.5' : 'gap-2')}>
          <ThemeToggleButton variant="sidebar" />
          {collapsed ? null : (
            <Link
              to={`/${salonId}/help`}
              onClick={onNavigate}
              className="text-muted-foreground hover:text-foreground inline-flex flex-1 items-center gap-1.5 px-1.5 text-[11px] font-medium"
            >
              <HelpCircle className="size-3.5" strokeWidth={1.7} />
              {t('nav.help')}
            </Link>
          )}
        </div>
      </div>

      {bugOpen ? (
        <Suspense fallback={null}>
          <TesterBugModal onClose={() => setBugOpen(false)} />
        </Suspense>
      ) : null}
    </aside>
  )
}
