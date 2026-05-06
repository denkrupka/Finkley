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
