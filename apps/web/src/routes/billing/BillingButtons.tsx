import { AlertTriangle } from 'lucide-react'
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

  // T82 — Stripe не настроен (нет VITE_STRIPE_PUBLISHABLE_KEY в build env).
  // Сами edge functions упадут на отсутствие STRIPE_SECRET_KEY, но мы
  // показываем UX banner заранее чтобы юзер не натыкался на сырую ошибку.
  const stripeAvailable = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

  const hasActive =
    subscription && (subscription.status === 'active' || subscription.status === 'trialing')

  if (!stripeAvailable) {
    return (
      <div className="flex max-w-md items-start gap-2 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs leading-snug text-amber-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <div>
          <p className="font-bold">
            {t('billing.unavailable_title', {
              defaultValue: 'Платежи временно недоступны',
            })}
          </p>
          <p className="mt-0.5">
            {t('billing.unavailable_body', {
              defaultValue:
                'Это техническая проблема на нашей стороне. Напиши в поддержку: support@finkley.app — подключим тебя вручную.',
            })}
          </p>
        </div>
      </div>
    )
  }

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
