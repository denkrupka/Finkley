import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useFinishBankConnect } from '@/hooks/useBanking'
import { useMySalons } from '@/hooks/useSalons'
import { rememberLastSalon } from '@/routes/RootRedirect'

/**
 * /banking/callback — landing после bank-auth в Enable Banking.
 *
 * EB редиректит сюда с ?code=...&state=<connection_id> (если успех)
 * либо ?error=...&error_description=... (если юзер отказал/таймаут).
 *
 * Делаем POST в banking-callback, ждём ответа, показываем итог
 * («подключили N счетов»). Кнопка «На страницу интеграций» возвращает
 * юзера на /salon/{id}/settings?tab=integrations.
 */
export function BankingCallbackPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  const errorDesc = params.get('error_description')

  const { data: salons = [] } = useMySalons()
  const finish = useFinishBankConnect(undefined)
  const [done, setDone] = useState<{
    ok: boolean
    bank_name?: string | null
    accounts_count?: number
    error?: string
  } | null>(null)

  useEffect(() => {
    if (error) {
      setDone({ ok: false, error: errorDesc ?? error })
      return
    }
    if (!code || !state) {
      setDone({ ok: false, error: 'missing_code_or_state' })
      return
    }
    finish.mutate(
      { code, state },
      {
        onSuccess: (res) => {
          setDone({ ok: true, bank_name: res.bank_name, accounts_count: res.accounts_count })
          // На случай возврата вкладки в кэш — освежим last salon, если в
          // sessionStorage был pending_connection (UX bonus).
          sessionStorage.removeItem('finkley:banking:pending_connection')
        },
        onError: (err) => {
          setDone({ ok: false, error: err instanceof Error ? err.message : String(err) })
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot effect on mount
  }, [])

  // Куда возвращать юзера: салон, в котором он был, либо первый из его списка.
  const targetSalon =
    salons.find((s) => s.id === localStorage.getItem('finkley:last-salon')) ?? salons[0] ?? null
  const backHref = targetSalon ? `/${targetSalon.id}/settings?tab=integrations` : '/'

  if (targetSalon) rememberLastSalon(targetSalon.id)

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-5 py-10">
      <div className="border-border bg-card shadow-finmd w-full max-w-md rounded-lg border p-7 text-center">
        {done === null ? (
          <>
            <Loader2 className="text-secondary mx-auto size-10 animate-spin" strokeWidth={1.8} />
            <h1 className="text-brand-navy mt-5 text-xl font-bold">
              {t('banking.callback.connecting_title')}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {t('banking.callback.connecting_body')}
            </p>
          </>
        ) : done.ok ? (
          <>
            <CheckCircle2 className="text-brand-sage mx-auto size-10" strokeWidth={1.8} />
            <h1 className="text-brand-navy mt-5 text-xl font-bold">
              {t('banking.callback.success_title')}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {t('banking.callback.success_body', {
                bank: done.bank_name ?? '?',
                count: done.accounts_count ?? 0,
              })}
            </p>
            <p className="text-muted-foreground mt-3 text-xs">
              {t('banking.callback.first_sync_hint')}
            </p>
            <Button asChild className="mt-6" size="lg">
              <Link to={backHref}>{t('banking.callback.back_to_integrations')}</Link>
            </Button>
          </>
        ) : (
          <>
            <XCircle className="text-destructive mx-auto size-10" strokeWidth={1.8} />
            <h1 className="text-brand-navy mt-5 text-xl font-bold">
              {t('banking.callback.error_title')}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">{t('banking.callback.error_body')}</p>
            {done.error ? (
              <p className="text-destructive bg-destructive/5 mt-3 rounded-md px-3 py-2 text-left text-xs">
                {done.error}
              </p>
            ) : null}
            <Button asChild className="mt-6" size="lg" variant="outline">
              <Link to={backHref}>{t('banking.callback.back_to_integrations')}</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
