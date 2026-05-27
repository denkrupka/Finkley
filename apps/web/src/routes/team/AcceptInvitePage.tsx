import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { LogoLockup } from '@/components/ui/logo'
import { useAuth } from '@/hooks/useAuth'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useAcceptInvitation } from '@/hooks/useTeam'

import { InviteSignupForm } from './InviteSignupForm'

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
  const { data: profile } = useMyProfile()
  const [error, setError] = useState<string | null>(null)
  /** Куда уходить после онбординга. Запоминаем salon_id после успешного accept. */
  const [pendingSalonId, setPendingSalonId] = useState<string | null>(null)
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
          // T25 — если профиль не заполнен (нет full_name или phone), показываем
          // форму онбординга перед редиректом на dashboard.
          setPendingSalonId(res.salon_id)
        }
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, token])

  // Когда accept успешен — решаем что показать: форму онбординга или сразу
  // редирект. Профиль уже подгружен через useMyProfile.
  const profileIncomplete = pendingSalonId && profile && (!profile.full_name || !profile.phone)
  const profileReady = pendingSalonId && profile && !profileIncomplete

  useEffect(() => {
    if (profileReady && pendingSalonId) {
      navigate(`/${pendingSalonId}/dashboard`, { replace: true })
    }
  }, [profileReady, pendingSalonId, navigate])

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-5">
      <div className="mb-8">
        <LogoLockup size={32} />
      </div>
      <div
        className={`border-border bg-card shadow-finsm w-full rounded-lg border p-8 ${
          profileIncomplete ? 'max-w-xl text-left' : 'max-w-md text-center'
        }`}
      >
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
        ) : profileIncomplete ? (
          <InviteSignupForm
            onComplete={() => {
              if (pendingSalonId) {
                // T48 — после первого онбординга приглашённого мастера сразу
                // запускаем общий тур с force=true (он сам отфильтрует шаги
                // по роли, staff увидит сокращённую версию).
                try {
                  localStorage.removeItem('finkley:tour:dismissed')
                } catch {
                  // ignore — query параметр всё равно сработает
                }
                navigate(`/${pendingSalonId}/dashboard?showTour=1`, { replace: true })
              }
            }}
          />
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
