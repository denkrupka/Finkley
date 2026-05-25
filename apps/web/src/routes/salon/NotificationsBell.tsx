import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, Bell, Info, MessageCircle, Sparkles, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useNotifications, type NotificationItem } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils/cn'

/**
 * Колокольчик-уведомления в TopBar. Бейдж = unreadCount, дропдаун со
 * списком событий. Пометить-всё-как-прочитанное обновляет last-seen в
 * localStorage. Не сохраняем notifications в БД — derive из существующих
 * виджетов (insights/upcoming/budgets), ничего нового не нужно.
 */
export function NotificationsBell({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { items, unreadCount, markAllRead } = useNotifications(salonId)
  const [open, setOpen] = useState(false)

  function handleOpenChange(o: boolean) {
    setOpen(o)
    if (!o && unreadCount > 0) markAllRead()
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="border-border bg-card hover:bg-muted/40 relative grid size-9 place-items-center rounded-md border"
          aria-label={t('notifications.aria_label')}
        >
          <Bell className="text-foreground size-4" strokeWidth={1.7} />
          {unreadCount > 0 ? (
            <span className="bg-destructive absolute -right-1 -top-1 grid size-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="border-border bg-card shadow-finlg z-50 w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border"
        >
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <p className="text-brand-navy text-sm font-bold">{t('notifications.title')}</p>
            <span className="text-muted-foreground text-xs">
              {t('notifications.count', { count: items.length })}
            </span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Sparkles className="text-muted-foreground mx-auto size-6" strokeWidth={1.5} />
                <p className="text-muted-foreground mt-2 text-sm">{t('notifications.empty')}</p>
              </div>
            ) : (
              items
                .slice(0, 12)
                .map((n) => (
                  <NotificationRow key={n.id} notification={n} onClick={() => setOpen(false)} />
                ))
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function NotificationRow({
  notification: n,
  onClick,
}: {
  notification: NotificationItem
  onClick: () => void
}) {
  const Icon =
    n.kind === 'messenger_message'
      ? MessageCircle
      : n.severity === 'critical'
        ? AlertTriangle
        : n.severity === 'warning'
          ? Zap
          : Info
  const colorCls =
    n.kind === 'messenger_message'
      ? 'text-brand-teal-deep'
      : n.severity === 'critical'
        ? 'text-destructive'
        : n.severity === 'warning'
          ? 'text-amber-600'
          : 'text-brand-teal-deep'

  const content = (
    <>
      <Icon className={cn('mt-0.5 size-4 shrink-0', colorCls)} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="text-brand-navy truncate text-sm font-bold">{n.title}</p>
        <p className="text-muted-foreground line-clamp-2 text-xs">{n.body}</p>
      </div>
    </>
  )

  if (n.link) {
    return (
      <Link
        to={n.link}
        onClick={onClick}
        className="border-border hover:bg-muted/30 flex items-start gap-3 border-b px-4 py-3 last:border-b-0"
      >
        {content}
      </Link>
    )
  }
  return (
    <div className="border-border flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
      {content}
    </div>
  )
}
