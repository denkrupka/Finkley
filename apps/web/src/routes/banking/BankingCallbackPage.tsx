import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { markBankConnectionError, useFinishBankConnect } from '@/hooks/useBanking'
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
  const qc = useQueryClient()
  const [done, setDone] = useState<{
    ok: boolean
    bank_name?: string | null
    accounts_count?: number
    error?: string
  } | null>(null)

  useEffect(() => {
    // Ошибка на стороне банка (?error=...) или битый редирект: edge-функция
    // banking-callback в этом случае НЕ вызывается, и pending-строка
    // bank_connections зависла бы навсегда — а онбординг/настройки считали
    // бы её живым подключением. Помечаем её как error, чтобы UI показывал
    // правду и предлагал переподключиться.
    if (error || !code || !state) {
      const msg = error ? (errorDesc ?? error) : 'missing_code_or_state'
      const connId = state ?? sessionStorage.getItem('finkley:banking:pending_connection')
      sessionStorage.removeItem('finkley:banking:pending_connection')
      if (connId) {
        void markBankConnectionError(connId, msg)
          .catch(() => {
            /* RLS/сеть — не блокируем показ ошибки юзеру */
          })
          .finally(() => {
            qc.invalidateQueries({ queryKey: ['bank-connections'] })
            setDone({ ok: false, error: msg })
          })
      } else {
        setDone({ ok: false, error: msg })
      }
      return
    }
    finish.mutate(
      { code, state },
      {
        onSuccess: (res) => {
          setDone({ ok: true, bank_name: res.bank_name, accounts_count: res.accounts_count })
          sessionStorage.removeItem('finkley:banking:pending_connection')
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err)
          sessionStorage.removeItem('finkley:banking:pending_connection')
          // Если edge уже пометил error — update по .eq(status,'pending')
          // будет no-op; если запрос вообще не дошёл — пометим сами.
          void markBankConnectionError(state, msg)
            .catch(() => {
              /* ignore */
            })
            .finally(() => {
              qc.invalidateQueries({ queryKey: ['bank-connections'] })
              setDone({ ok: false, error: msg })
            })
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot effect on mount
  }, [])

  // Куда возвращать юзера: салон, в котором он был, либо первый из его списка.
  const targetSalon =
    salons.find((s) => s.id === localStorage.getItem('finkley:last-salon')) ?? salons[0] ?? null
  // OAuth-return-onboarding флаг приоритетнее: если юзер запустил PSD2
  // из онбординга — вернёмся туда вместо /settings/integrations. Читаем
  // one-shot в state (значение стабильно между рендерами) и чистим флаг,
  // как только исход известен — И при успехе, И при ошибке: юзер в обоих
  // случаях возвращается в онбординг, а протухший флаг не должен потом
  // утаскивать его туда из /settings.
  const [onboardingReturn] = useState<string | null>(() => {
    try {
      return localStorage.getItem('finkley:oauth-return-onboarding')
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (done === null || !onboardingReturn) return
    try {
      localStorage.removeItem('finkley:oauth-return-onboarding')
    } catch {
      /* ignore */
    }
  }, [done, onboardingReturn])
  const backHref = onboardingReturn
    ? `/onboarding?salon=${onboardingReturn}`
    : targetSalon
      ? `/${targetSalon.id}/settings?tab=integrations`
      : '/'

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
            {/* T39 — типичная ошибка whitelist: даём юзеру понятную
                инструкцию + контакт владельца, а не сырую строку. */}
            {done.error && /redirect_uri_not_allowed|invalid_redirect_uri/i.test(done.error) ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-left text-xs leading-snug text-amber-900">
                <p className="font-bold">
                  {t('banking.callback.whitelist_title', {
                    defaultValue: 'Подключение временно недоступно',
                  })}
                </p>
                <p className="mt-1">
                  {t('banking.callback.whitelist_body', {
                    defaultValue:
                      'Это техническая проблема на нашей стороне — мы уже знаем и работаем над фиксом. Попробуй позже или напиши в поддержку: support@finkley.app.',
                  })}
                </p>
              </div>
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
