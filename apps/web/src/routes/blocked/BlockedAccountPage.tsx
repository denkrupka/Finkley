import { Lock, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'

/**
 * Страница «Ваш аккаунт заблокирован». Показывается, когда юзер пытается
 * войти и Supabase Auth возвращает user_banned, либо когда уже залогиненный
 * юзер был забанен super-админом и его сессия истекла.
 */
export function BlockedAccountPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center p-6">
      <div className="border-border bg-card shadow-finmd flex max-w-md flex-col items-center gap-4 rounded-lg border p-8 text-center">
        <Lock className="text-destructive size-12" strokeWidth={1.2} />
        <h1 className="text-foreground text-xl font-bold">{t('blocked.account.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('blocked.account.body')}</p>
        <p className="text-muted-foreground text-xs">
          {t('blocked.account.contact')}{' '}
          <a className="text-primary underline" href="mailto:support@finsalon.app">
            support@finsalon.app
          </a>
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="size-3.5" strokeWidth={1.8} />
            {t('blocked.account.sign_out')}
          </Button>
          <Link
            to="/login"
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            {t('blocked.account.back_to_login')}
          </Link>
        </div>
      </div>
    </div>
  )
}
