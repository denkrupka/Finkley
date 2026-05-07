import { Loader2, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  BOOKSY_SYNC_INTERVAL_OPTIONS,
  useBooksyLogin,
  useUpdateBooksyInterval,
} from '@/hooks/useIntegrations'
import { BOOKSY_HCAPTCHA_SITEKEY, loadHCaptcha } from '@/lib/hcaptcha'

/**
 * BooksyConnectDialog — Метод 3 (proxy form):
 *   1) Юзер вводит email/password
 *   2) hcaptcha.execute() (invisible — обычно даже challenge не показывает)
 *   3) Шлём captcha_token + creds в booksy-proxy edge function
 *
 * Fallback по токену намеренно скрыт от UI, но edge function action
 * 'login_with_token' остаётся живым на случай саппорт-сценариев.
 */
export function BooksyConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [interval, setInterval] = useState<number>(60)
  const [captchaReady, setCaptchaReady] = useState(false)
  const [captchaError, setCaptchaError] = useState<string | null>(null)
  const captchaContainerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | number | null>(null)

  const booksyLogin = useBooksyLogin(salonId)
  const updateInterval = useUpdateBooksyInterval(salonId)
  const isPending = booksyLogin.isPending

  // Сброс полей при открытии/закрытии
  useEffect(() => {
    if (!open) {
      setEmail('')
      setPassword('')
      setInterval(60)
      setCaptchaError(null)
    }
  }, [open])

  // Загружаем hCaptcha когда диалог открыт
  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadHCaptcha()
      .then(() => {
        if (cancelled) return
        if (!window.hcaptcha || !captchaContainerRef.current) return
        if (widgetIdRef.current !== null) {
          setCaptchaReady(true)
          return
        }
        const id = window.hcaptcha.render(captchaContainerRef.current, {
          sitekey: BOOKSY_HCAPTCHA_SITEKEY,
          size: 'invisible',
        })
        widgetIdRef.current = id
        setCaptchaReady(true)
      })
      .catch((e) => {
        if (cancelled) return
        setCaptchaError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Удаляем виджет при закрытии чтобы при повторном открытии
  // hcaptcha не ругался "already rendered".
  useEffect(() => {
    if (open) return
    if (widgetIdRef.current !== null && window.hcaptcha) {
      try {
        window.hcaptcha.remove(widgetIdRef.current)
      } catch {
        // ignore
      }
      widgetIdRef.current = null
      setCaptchaReady(false)
    }
  }, [open])

  function explainBooksyError(code: string): string {
    switch (code) {
      case 'invalid_credentials':
        return t('integrations.errors.booksy_invalid_credentials')
      case 'request_blocked':
        return t('integrations.errors.booksy_request_blocked')
      case 'rate_limited':
        return t('integrations.errors.booksy_rate_limited')
      case 'no_businesses_in_account':
        return t('integrations.errors.booksy_no_business')
      default:
        return code
    }
  }

  async function handleSubmit() {
    if (!email.trim() || !password) {
      toast.error(t('integrations.errors.fields_required'))
      return
    }
    if (!captchaReady || widgetIdRef.current === null || !window.hcaptcha) {
      toast.error(t('integrations.errors.captcha_not_ready'))
      return
    }
    let captchaToken: string
    try {
      const res = await window.hcaptcha.execute(widgetIdRef.current, { async: true })
      captchaToken = res.response
    } catch (e) {
      toast.error(t('integrations.errors.captcha_solve_failed'))
      console.warn('hcaptcha execute failed:', e)
      return
    }
    booksyLogin.mutate(
      { email: email.trim(), password, captchaToken },
      {
        onSuccess: (res) => {
          // После успешного login проставляем выбранный интервал
          updateInterval.mutate(interval)
          toast.success(t('integrations.toast_connected', { name: res.business?.name ?? 'Booksy' }))
          onClose()
        },
        onError: (err) => {
          if (err instanceof Error && /^[a-z_]+$/.test(err.message)) {
            toast.error(explainBooksyError(err.message))
          } else {
            toast.error(err instanceof Error ? err.message : String(err))
          }
          // Сбросить капчу для повторной попытки
          if (widgetIdRef.current !== null && window.hcaptcha) {
            window.hcaptcha.reset(widgetIdRef.current)
          }
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('integrations.connect_title', { name: 'Booksy' })}</DialogTitle>
          <DialogDescription>
            {t('integrations.connect_subtitle', { name: 'Booksy' })}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 px-5 pb-2 pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booksy-email">{t('integrations.fields.email_or_phone')}</Label>
            <Input
              id="booksy-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booksy-password">{t('integrations.fields.password')}</Label>
            <Input
              id="booksy-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booksy-interval">{t('integrations.sync_interval_label')}</Label>
            <select
              id="booksy-interval"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              className="border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm"
            >
              {BOOKSY_SYNC_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label_key)}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">{t('integrations.sync_interval_hint')}</p>
          </div>

          {/* Контейнер для invisible hCaptcha */}
          <div ref={captchaContainerRef} />
          {captchaError ? (
            <p className="text-destructive text-xs">
              {t('integrations.errors.captcha_load_failed')}: {captchaError}
            </p>
          ) : null}

          <div className="border-secondary/30 bg-secondary/5 flex items-start gap-2 rounded-md border p-3">
            <Lock className="text-secondary mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
            <p className="text-foreground/80 text-xs leading-snug">
              {t('integrations.security_note')}
            </p>
          </div>
        </form>

        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending || !captchaReady}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                {t('integrations.connecting')}
              </>
            ) : (
              t('integrations.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
