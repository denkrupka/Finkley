import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import type { SalonSubscription } from '@/hooks/useSubscription'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

async function callEdgeFunction(name: string, body: unknown): Promise<{ url: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('not_authenticated')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { url?: string; error?: string; message?: string }
  if (!res.ok || !json.url) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`)
  }
  return { url: json.url }
}

/**
 * Кнопка «Оформить подписку» (если ещё нет) или «Управление подпиской»
 * (если уже оформлена). Используется в Settings и на pricing-странице.
 */
export function BillingButtons({
  salonId,
  subscription,
}: {
  salonId: string
  subscription: SalonSubscription | null
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  const hasActive =
    subscription && (subscription.status === 'active' || subscription.status === 'trialing')

  async function startCheckout() {
    setPending(true)
    try {
      const { url } = await callEdgeFunction('create-checkout-session', { salonId })
      window.location.href = url
    } catch (err) {
      toast.error(t('billing.checkout_error'), {
        description: err instanceof Error ? err.message : String(err),
      })
      setPending(false)
    }
  }

  async function openPortal() {
    setPending(true)
    try {
      const { url } = await callEdgeFunction('create-portal-session', { salonId })
      window.location.href = url
    } catch (err) {
      toast.error(t('billing.portal_error'), {
        description: err instanceof Error ? err.message : String(err),
      })
      setPending(false)
    }
  }

  if (!hasActive) {
    return (
      <Button onClick={startCheckout} disabled={pending} size="md" data-testid="billing-checkout">
        {pending ? t('common.loading') : t('billing.checkout_button')}
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      onClick={openPortal}
      disabled={pending}
      size="md"
      data-testid="billing-portal"
    >
      {pending ? t('common.loading') : t('billing.portal_button')}
    </Button>
  )
}
