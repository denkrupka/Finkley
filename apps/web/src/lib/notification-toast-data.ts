/**
 * Pure-helper: маппинг in_app_notifications row → данные для toast'а
 * (title + description + url). Вынесено из useRealtimeNotifications чтобы
 * можно было протестировать без DOM / Supabase realtime / sonner.
 *
 * Toast UI и markRead остаются в хуке.
 */

export type InAppNotification = {
  id: string
  user_id: string
  salon_id: string | null
  type: string
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export type ToastData = {
  title: string
  description: string
  url: string | undefined
}

type TFn = (k: string, opts?: Record<string, unknown>) => string

/** Build title/description/url для toast по типу нотификации. Без сайд-эффектов. */
export function buildToastData(
  n: InAppNotification,
  ctx: { t: TFn; salonId: string | undefined },
): ToastData {
  const { type, payload } = n
  const sid = n.salon_id || ctx.salonId

  switch (type) {
    case 'ai_insights':
      return {
        title: `🔮 ${String(payload.headline ?? '')}`,
        description: String(payload.body ?? ''),
        url: sid ? `/${sid}/dashboard` : undefined,
      }
    case 'low_inventory': {
      const items = (payload.items as Array<{ name: string }>) ?? []
      return {
        title: ctx.t('notif.low_inv_title', { defaultValue: '⚠️ Заканчиваются материалы' }),
        description: ctx.t('notif.low_inv_desc', {
          defaultValue: '{{n}} позиций ниже минимума',
          n: items.length,
        }),
        url: sid ? `/${sid}/inventory` : undefined,
      }
    }
    case 'payment_due_2d':
    case 'payment_due_1d':
    case 'payment_due_today':
    case 'payment_overdue': {
      const titleKey =
        type === 'payment_overdue'
          ? 'notif.payment_overdue'
          : type === 'payment_due_today'
            ? 'notif.payment_due_today'
            : type === 'payment_due_1d'
              ? 'notif.payment_due_1d'
              : 'notif.payment_due_2d'
      const fallback =
        type === 'payment_overdue'
          ? '🔴 Платёж просрочен'
          : type === 'payment_due_today'
            ? '⏰ Платёж сегодня'
            : type === 'payment_due_1d'
              ? '⏰ Платёж завтра'
              : '🗓 Платёж через 2 дня'
      return {
        title: ctx.t(titleKey, { defaultValue: fallback }),
        description: `${String(payload.counterparty ?? '')} · ${String(payload.amount_formatted ?? '')}`,
        url: sid ? `/${sid}/expenses?tab=pending` : undefined,
      }
    }
    case 'booksy_new_visits':
      return {
        title: ctx.t('notif.booksy_title', {
          defaultValue: '📅 Импорт из Booksy: +{{n}} визитов',
          n: payload.count ?? 0,
        }),
        description: '',
        url: sid ? `/${sid}/income?tab=visits` : undefined,
      }
    case 'calendar_conflicts': {
      const conflicts = (payload.conflicts as Array<unknown>) ?? []
      return {
        title: ctx.t('notif.conflict_title', { defaultValue: '⚠️ Конфликт в календаре' }),
        description: ctx.t('notif.conflict_desc', {
          defaultValue: '{{n}} двойных записей',
          n: conflicts.length,
        }),
        url: sid ? `/${sid}/income?tab=visits&view=calendar` : undefined,
      }
    }
    case 'messenger_new_message':
      return {
        title: ctx.t('notif.messenger_title', {
          defaultValue: '💬 Новое сообщение · {{sender}}',
          sender: String(payload.sender ?? ''),
        }),
        description: String(payload.preview ?? ''),
        url: sid ? `/${sid}/messenger` : undefined,
      }
    case 'weekly_digest':
      return {
        title: ctx.t('notif.weekly_digest', { defaultValue: '📊 Дайджест за неделю готов' }),
        description: '',
        url: sid ? `/${sid}/reports` : undefined,
      }
    case 'daily_digest':
      return {
        title: ctx.t('notif.daily_digest', { defaultValue: '📊 Сводка за день готова' }),
        description: '',
        url: sid ? `/${sid}/reports` : undefined,
      }
    default:
      return {
        title: ctx.t('notif.generic', { defaultValue: '🔔 Уведомление' }),
        description: '',
        url: undefined,
      }
  }
}
