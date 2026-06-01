import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, Bell, Check, Info, MessageCircle, Sparkles, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useMarkInAppRead, useNotifications, type NotificationItem } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils/cn'
import { renderMarkdownInline } from '@/lib/utils/render-markdown-inline'

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
  const hasInApp = items.some((i) => i.kind === 'in_app')

  function handleOpenChange(o: boolean) {
    setOpen(o)
    if (!o && unreadCount > 0) markAllRead()
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-tour="bell"
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
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {t('notifications.count', { count: items.length })}
              </span>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="text-secondary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
                  title={t('notifications.mark_all_read', { defaultValue: 'Прочитать всё' })}
                >
                  <Check className="size-3" strokeWidth={2.4} />
                  {t('notifications.mark_all_read_short', { defaultValue: 'Всё' })}
                </button>
              ) : null}
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Sparkles className="text-muted-foreground mx-auto size-6" strokeWidth={1.5} />
                <p className="text-muted-foreground mt-2 text-sm">{t('notifications.empty')}</p>
              </div>
            ) : (
              items
                .slice(0, 20)
                .map((n) => (
                  <NotificationRow key={n.id} notification={n} onClick={() => setOpen(false)} />
                ))
            )}
          </div>
          {hasInApp ? (
            <div className="border-border border-t px-4 py-2.5">
              <Link
                to={`/${salonId}/notifications`}
                onClick={() => setOpen(false)}
                className="text-secondary inline-flex w-full justify-center text-xs font-semibold hover:underline"
              >
                {t('notifications.see_all', { defaultValue: 'Показать все' })}
              </Link>
            </div>
          ) : null}
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
  const markOne = useMarkInAppRead()
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

  // T43 — для in_app: unread → точка-dot слева + жирнее текст; при клике
  // маркируем как прочитанное в БД.
  const isUnreadInApp = n.kind === 'in_app' && n.read === false

  const content = (
    <>
      <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
        {isUnreadInApp ? (
          <span className="bg-destructive size-1.5 shrink-0 rounded-full" aria-hidden />
        ) : null}
        <Icon className={cn('size-4', colorCls)} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-brand-navy truncate text-sm',
            isUnreadInApp ? 'font-bold' : 'font-semibold',
          )}
        >
          {renderMarkdownInline(n.title)}
        </p>
        <p className="text-muted-foreground line-clamp-2 text-xs">{renderMarkdownInline(n.body)}</p>
      </div>
    </>
  )

  function handleClick() {
    if (n.kind === 'in_app' && n.dbId && n.read === false) {
      markOne.mutate(n.dbId)
    }
    onClick()
  }

  const className = cn(
    'border-border flex items-start gap-3 border-b px-4 py-3 last:border-b-0',
    isUnreadInApp ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-muted/30',
  )

  if (n.link) {
    return (
      <Link to={n.link} onClick={handleClick} className={className}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" onClick={handleClick} className={cn(className, 'w-full text-left')}>
      {content}
    </button>
  )
}
