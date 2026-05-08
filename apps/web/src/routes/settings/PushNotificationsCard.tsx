import { Bell, BellOff, Loader2, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  usePushPermission,
  useSubscribePush,
  useTestPush,
  useUnsubscribePush,
} from '@/hooks/usePushNotifications'

export function PushNotificationsCard() {
  const { t } = useTranslation()
  const { state, isSubscribed, loading } = usePushPermission()
  const subscribe = useSubscribePush()
  const unsubscribe = useUnsubscribePush()
  const test = useTestPush()

  if (loading) return null

  const unsupported = state === 'unsupported'
  const denied = state === 'denied'

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="flex items-start gap-3">
        <span
          className="bg-secondary/10 text-secondary grid size-9 shrink-0 place-items-center rounded-md"
          aria-hidden
        >
          {isSubscribed ? (
            <Bell className="size-4" strokeWidth={1.8} />
          ) : (
            <BellOff className="size-4" strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-brand-navy text-base font-bold">{t('settings.push.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-snug">
            {t('settings.push.subtitle')}
          </p>
        </div>
      </div>

      {unsupported ? (
        <p className="border-border bg-muted/30 mt-4 rounded-md border p-3 text-xs leading-snug">
          {t('settings.push.unsupported')}
        </p>
      ) : denied && !isSubscribed ? (
        <p className="border-destructive/30 bg-destructive/5 text-destructive mt-4 rounded-md border p-3 text-xs leading-snug">
          {t('settings.push.denied')}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isSubscribed ? (
          <>
            <Button
              variant="outline"
              size="md"
              onClick={() =>
                unsubscribe.mutate(undefined, {
                  onSuccess: () => toast.success(t('settings.push.toast_unsubscribed')),
                  onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                })
              }
              disabled={unsubscribe.isPending}
            >
              {unsubscribe.isPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <BellOff className="size-4" strokeWidth={1.8} />
              )}
              {t('settings.push.disable')}
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() =>
                test.mutate(undefined, {
                  onSuccess: (n) => toast.success(t('settings.push.toast_test_sent', { count: n })),
                  onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                })
              }
              disabled={test.isPending}
            >
              {test.isPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <Send className="size-4" strokeWidth={1.8} />
              )}
              {t('settings.push.send_test')}
            </Button>
          </>
        ) : (
          <Button
            size="md"
            onClick={() =>
              subscribe.mutate(undefined, {
                onSuccess: () => toast.success(t('settings.push.toast_subscribed')),
                onError: (err) => {
                  const msg = err instanceof Error ? err.message : String(err)
                  if (msg === 'permission_denied') toast.error(t('settings.push.denied'))
                  else if (msg === 'push_unsupported') toast.error(t('settings.push.unsupported'))
                  else if (msg === 'vapid_public_key_missing')
                    toast.error(t('settings.push.not_configured'))
                  else toast.error(msg)
                },
              })
            }
            disabled={subscribe.isPending || unsupported || denied}
          >
            {subscribe.isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <Bell className="size-4" strokeWidth={1.8} />
            )}
            {t('settings.push.enable')}
          </Button>
        )}
      </div>
    </section>
  )
}
