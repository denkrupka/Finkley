import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { LogoLockup } from '@/components/ui/logo'
import { useAuth } from '@/hooks/useAuth'
import { useAcceptInvitation } from '@/hooks/useTeam'

/**
 * /accept-invite?token=...
 *
 * Если юзер не авторизован — редирект на /login с returnUrl=current,
 * после login возвращается обратно и accept срабатывает автоматически.
 */
export function AcceptInvitePage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const accept = useAcceptInvitation()
  const [error, setError] = useState<string | null>(null)
  const calledRef = useRef(false)

  const token = params.get('token')

  useEffect(() => {
    if (authLoading) return
    if (!token) {
      setError('missing_token')
      return
    }
    if (!user) {
      // Сохраняем intent и идём на login
      const next = `/accept-invite?token=${encodeURIComponent(token)}`
      navigate(`/login?returnTo=${encodeURIComponent(next)}`, { replace: true })
      return
    }
    if (calledRef.current) return
    calledRef.current = true

    accept.mutate(token, {
      onSuccess: (res) => {
        if (res.salon_id) {
          navigate(`/${res.salon_id}/dashboard`, { replace: true })
        }
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, token])

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-5">
      <div className="mb-8">
        <LogoLockup size={32} />
      </div>
      <div className="border-border bg-card shadow-finsm w-full max-w-md rounded-lg border p-8 text-center">
        {error ? (
          <>
            <h1 className="text-brand-navy text-xl font-bold">
              {t(`team.accept_error.${error}`, t('team.accept_error.unknown'))}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">{t('team.accept_error_subtitle')}</p>
            <Link to="/" className="mt-6 inline-block">
              <Button>{t('common.back_home')}</Button>
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="text-secondary mx-auto mb-4 size-8 animate-spin" strokeWidth={2} />
            <h1 className="text-brand-navy text-xl font-bold">{t('team.accept_loading')}</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {t('team.accept_loading_subtitle')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
