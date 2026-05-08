/**
 * Server-side helper для вызова send-email из других edge functions
 * (например, из stripe-webhook). Использует FUNCTION_INTERNAL_SECRET,
 * чтобы пройти shared-secret проверку send-email.
 *
 * Все ошибки только логируем — отправка email не должна блокировать
 * основную бизнес-логику webhook'а (event важнее, чем уведомление).
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const FUNCTION_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

export type EmailTemplate =
  | 'welcome'
  | 'trial_ending'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'weekly_digest'
  | 'team_invitation'

/**
 * Возвращает готовый HTML-блок с логотипом салона для подстановки в письмо.
 * Если URL пустой — возвращает пустую строку (рендерер просто ничего
 * не вставит). Стили inline, потому что email-клиенты дропают `<style>`.
 */
export function renderLogoBlock(logoUrl: string | null | undefined): string {
  if (!logoUrl) return ''
  return `<img src="${logoUrl}" alt="" style="display:block;max-width:120px;max-height:48px;margin:0 0 16px 0;border-radius:6px;" />`
}

/**
 * Шлёт сообщение владельцу в Telegram через @finklay_dev_bot. Никогда
 * не бросает, только console.warn. Используется для критических алертов
 * вроде «3 раза подряд упал sync Booksy».
 *
 * Если задан TELEGRAM_THREAD_BUGS — шлём в тему «Баги», иначе в general.
 */
export async function notifyOwnerTelegram(
  text: string,
  options: { thread?: 'bugs' | 'features' } = {},
): Promise<void> {
  const token = Deno.env.get('TELEGRAM_BUG_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_BUG_CHAT_ID')
  if (!token || !chatId) {
    console.warn('notifyOwnerTelegram: not configured')
    return
  }
  const threadKey =
    options.thread === 'features' ? 'TELEGRAM_THREAD_FEATURES' : 'TELEGRAM_THREAD_BUGS'
  const threadId = Deno.env.get(threadKey)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(threadId ? { message_thread_id: Number(threadId) } : {}),
      }),
    })
    if (!res.ok) {
      console.warn('notifyOwnerTelegram failed:', res.status, await res.text().catch(() => ''))
    }
  } catch (e) {
    console.warn('notifyOwnerTelegram exception:', e instanceof Error ? e.message : e)
  }
}

/**
 * Записывает результат sync-а интеграции и при 3+ fail подряд шлёт
 * telegram-алерт владельцу. Не чаще 1 раза в 24 часа на пару (salon, provider).
 */
export async function recordSyncResult(
  admin: { from: (t: string) => any },
  input: {
    salonId: string
    provider: string
    ok: boolean
    errorMessage?: string | null
    salonName?: string | null
  },
): Promise<void> {
  if (input.ok) {
    await admin
      .from('salon_integrations')
      .update({ consecutive_failures: 0, last_error: null, last_sync_at: new Date().toISOString() })
      .eq('salon_id', input.salonId)
      .eq('provider', input.provider)
    return
  }

  const { data: row } = await admin
    .from('salon_integrations')
    .select('consecutive_failures, last_failure_alert_at')
    .eq('salon_id', input.salonId)
    .eq('provider', input.provider)
    .maybeSingle()
  const prevCount = (row as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0
  const newCount = prevCount + 1
  const lastAlert =
    (row as { last_failure_alert_at?: string | null } | null)?.last_failure_alert_at ?? null

  await admin
    .from('salon_integrations')
    .update({
      consecutive_failures: newCount,
      last_error: input.errorMessage ?? 'unknown',
      status: 'error',
    })
    .eq('salon_id', input.salonId)
    .eq('provider', input.provider)

  // Алерт при 3+ подряд, не чаще 1 раза в 24 часа
  if (newCount >= 3) {
    const now = Date.now()
    const lastAlertMs = lastAlert ? new Date(lastAlert).getTime() : 0
    if (now - lastAlertMs >= 24 * 3600 * 1000) {
      const salonLabel = input.salonName
        ? `салон <b>${input.salonName}</b>`
        : `салон <code>${input.salonId}</code>`
      const text =
        `🔴 <b>Sync ${input.provider}</b> упал ${newCount}× подряд для ${salonLabel}\n\n` +
        `Последняя ошибка:\n<code>${(input.errorMessage ?? 'unknown').slice(0, 500)}</code>`
      await notifyOwnerTelegram(text, { thread: 'bugs' })
      await admin
        .from('salon_integrations')
        .update({ last_failure_alert_at: new Date().toISOString() })
        .eq('salon_id', input.salonId)
        .eq('provider', input.provider)
    }
  }
}

export async function sendEmail(
  template: EmailTemplate,
  to: string,
  vars: Record<string, string | number | null>,
): Promise<void> {
  if (!SUPABASE_URL || !FUNCTION_SECRET) {
    console.warn('sendEmail: not configured (missing SUPABASE_URL or FUNCTION_INTERNAL_SECRET)')
    return
  }
  if (!to) {
    console.warn(`sendEmail[${template}]: no recipient, skipping`)
    return
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Finkley-Secret': FUNCTION_SECRET,
      },
      body: JSON.stringify({ template, to, vars }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`sendEmail[${template}] failed: HTTP ${res.status}`, body)
    }
  } catch (err) {
    console.error(`sendEmail[${template}] threw:`, err)
  }
}
