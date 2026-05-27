import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase/client'

async function markReadById(id: string) {
  await supabase
    .from('in_app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
}

type InAppNotification = {
  id: string
  user_id: string
  salon_id: string | null
  type: string
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

/**
 * T42 — подписка на realtime in_app_notifications для текущего юзера.
 * При INSERT новой записи (отправляется из send-notification Edge Function)
 * показываем toast с действием «Открыть».
 *
 * Используется один раз в корневом layout (SalonLayout), чтобы подписка жила
 * пока юзер в портале.
 */
export function useRealtimeNotifications(salonId: string | undefined) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`in-app-notif:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'in_app_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as InAppNotification
          showToastForNotification(row, { t, navigate, salonId })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, t, navigate, salonId])
}

function showToastForNotification(
  n: InAppNotification,
  ctx: {
    t: (k: string, opts?: Record<string, unknown>) => string
    navigate: (path: string) => void
    salonId: string | undefined
  },
) {
  const { type, payload } = n
  const sid = n.salon_id || ctx.salonId
  let title = ''
  let description = ''
  let url: string | undefined

  switch (type) {
    case 'ai_insights':
      title = `🔮 ${String(payload.headline ?? '')}`
      description = String(payload.body ?? '')
      url = sid ? `/${sid}/dashboard` : undefined
      break
    case 'low_inventory': {
      const items = (payload.items as Array<{ name: string }>) ?? []
      title = ctx.t('notif.low_inv_title', { defaultValue: '⚠️ Заканчиваются материалы' })
      description = ctx.t('notif.low_inv_desc', {
        defaultValue: '{{n}} позиций ниже минимума',
        n: items.length,
      })
      url = sid ? `/${sid}/inventory` : undefined
      break
    }
    case 'payment_due_2d':
    case 'payment_due_1d':
    case 'payment_due_today':
    case 'payment_overdue':
      title =
        type === 'payment_overdue'
          ? ctx.t('notif.payment_overdue', { defaultValue: '🔴 Платёж просрочен' })
          : type === 'payment_due_today'
            ? ctx.t('notif.payment_due_today', { defaultValue: '⏰ Платёж сегодня' })
            : type === 'payment_due_1d'
              ? ctx.t('notif.payment_due_1d', { defaultValue: '⏰ Платёж завтра' })
              : ctx.t('notif.payment_due_2d', { defaultValue: '🗓 Платёж через 2 дня' })
      description = `${String(payload.counterparty ?? '')} · ${String(payload.amount_formatted ?? '')}`
      url = sid ? `/${sid}/expenses?tab=pending` : undefined
      break
    case 'booksy_new_visits':
      title = ctx.t('notif.booksy_title', {
        defaultValue: '📅 Импорт из Booksy: +{{n}} визитов',
        n: payload.count ?? 0,
      })
      url = sid ? `/${sid}/income?tab=visits` : undefined
      break
    case 'calendar_conflicts': {
      const conflicts = (payload.conflicts as Array<unknown>) ?? []
      title = ctx.t('notif.conflict_title', { defaultValue: '⚠️ Конфликт в календаре' })
      description = ctx.t('notif.conflict_desc', {
        defaultValue: '{{n}} двойных записей',
        n: conflicts.length,
      })
      url = sid ? `/${sid}/income?tab=visits&view=calendar` : undefined
      break
    }
    case 'messenger_new_message':
      title = ctx.t('notif.messenger_title', {
        defaultValue: '💬 Новое сообщение · {{sender}}',
        sender: String(payload.sender ?? ''),
      })
      description = String(payload.preview ?? '')
      url = sid ? `/${sid}/messenger` : undefined
      break
    case 'weekly_digest':
      title = ctx.t('notif.weekly_digest', { defaultValue: '📊 Дайджест за неделю готов' })
      url = sid ? `/${sid}/reports` : undefined
      break
    case 'daily_digest':
      title = ctx.t('notif.daily_digest', { defaultValue: '📊 Сводка за день готова' })
      url = sid ? `/${sid}/reports` : undefined
      break
    default:
      title = ctx.t('notif.generic', { defaultValue: '🔔 Уведомление' })
  }

  toast(title, {
    description: description.slice(0, 240),
    duration: 8000,
    action: url
      ? {
          label: ctx.t('common.open', { defaultValue: 'Открыть' }),
          onClick: () => {
            // T43 — авто-mark-as-read при клике по toast.
            void markReadById(n.id)
            ctx.navigate(url!)
          },
        }
      : undefined,
  })
}
