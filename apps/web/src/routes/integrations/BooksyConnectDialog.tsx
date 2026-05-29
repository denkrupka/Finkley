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
  useBooksySync,
  useUpdateBooksyConfig,
  useUpdateBooksyInterval,
} from '@/hooks/useIntegrations'
import { BOOKSY_HCAPTCHA_SITEKEY, loadHCaptcha } from '@/lib/hcaptcha'
import { consumeOnboardingCredentials } from '@/lib/onboarding-credentials'

/**
 * BooksyConnectDialog — двух-шаговый flow:
 *   1) login — email/password + hcaptcha + интервал
 *   2) config — 2 онбординг-вопроса (ADR-017 §5): отмечает ли юзер статусы
 *      оплат в Booksy? удаляет ли визиты? — для настройки логики синка.
 */
type Step = 'login' | 'config'

export function BooksyConnectDialog({
  open,
  onClose,
  salonId: salonIdProp,
}: {
  open: boolean
  onClose: () => void
  salonId?: string
}) {
  const { t } = useTranslation()
  const { salonId: salonIdFromUrl } = useParams<{ salonId: string }>()
  const salonId = salonIdProp ?? salonIdFromUrl
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [interval, setInterval] = useState<number>(60)
  const [captchaReady, setCaptchaReady] = useState(false)
  const [captchaError, setCaptchaError] = useState<string | null>(null)
  const captchaContainerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | number | null>(null)

  // Step 2 — config answers
  const [marksPaymentsInBooksy, setMarksPaymentsInBooksy] = useState<boolean | null>(null)
  const [deletesVisitsInBooksy, setDeletesVisitsInBooksy] = useState<boolean | null>(null)

  const booksyLogin = useBooksyLogin(salonId)
  const updateInterval = useUpdateBooksyInterval(salonId)
  const updateConfig = useUpdateBooksyConfig(salonId)
  const booksySync = useBooksySync(salonId)
  const isPending = booksyLogin.isPending || updateConfig.isPending || booksySync.isPending

  useEffect(() => {
    if (!open) {
      setStep('login')
      setEmail('')
      setPassword('')
      setInterval(60)
      setCaptchaError(null)
      setMarksPaymentsInBooksy(null)
      setDeletesVisitsInBooksy(null)
      return
    }
    // T150 — pre-fill credentials собранных в онбординге.
    if (salonId) {
      const creds = consumeOnboardingCredentials(salonId, 'booksy')
      if (creds) {
        if (creds.email) setEmail(creds.email)
        if (creds.password) setPassword(creds.password)
      }
    }
  }, [open, salonId])

  useEffect(() => {
    if (!open || step !== 'login') return
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
  }, [open, step])

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

  async function handleLoginSubmit() {
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
        onSuccess: () => {
          updateInterval.mutate(interval)
          setStep('config')
        },
        onError: (err) => {
          if (err instanceof Error && /^[a-z_]+$/.test(err.message)) {
            toast.error(explainBooksyError(err.message))
          } else {
            toast.error(err instanceof Error ? err.message : String(err))
          }
          if (widgetIdRef.current !== null && window.hcaptcha) {
            window.hcaptcha.reset(widgetIdRef.current)
          }
        },
      },
    )
  }

  function handleConfigSubmit() {
    if (marksPaymentsInBooksy === null || deletesVisitsInBooksy === null) {
      toast.error(t('integrations.errors.fields_required'))
      return
    }
    updateConfig.mutate(
      {
        booksy_owns_payment_status: marksPaymentsInBooksy,
        booksy_can_delete_visits: deletesVisitsInBooksy,
      },
      {
        onSuccess: () => {
          toast.success(t('integrations.toast_connected', { name: 'Booksy' }))
          // Триггерим полный sync СРАЗУ (не ждём 2-минутного cron'а) —
          // чтобы invite-модалка увидела импортированных мастеров.
          booksySync.mutate(undefined, {
            onSettled: () => onClose(),
          })
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err))
        },
      },
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === 'login'
              ? t('integrations.connect_title', { name: 'Booksy' })
              : t('integrations.booksy_config_title')}
          </DialogTitle>
          <DialogDescription>
            {step === 'login'
              ? t('integrations.connect_subtitle', { name: 'Booksy' })
              : t('integrations.booksy_config_subtitle')}
          </DialogDescription>
        </DialogHeader>

        {step === 'login' ? (
          <>
            <form
              className="flex flex-col gap-4 px-5 pb-2 pt-3"
              onSubmit={(e) => {
                e.preventDefault()
                void handleLoginSubmit()
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
                <p className="text-muted-foreground text-xs">
                  {t('integrations.sync_interval_hint')}
                </p>
              </div>

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
              <Button
                type="button"
                onClick={handleLoginSubmit}
                disabled={isPending || !captchaReady}
              >
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
          </>
        ) : (
          <>
            <div className="flex flex-col gap-5 px-5 pb-2 pt-3 text-sm">
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t('integrations.booksy_config_intro')}
              </p>

              {/* Q1 — marks payment statuses */}
              <div className="flex flex-col gap-2">
                <Label>{t('integrations.booksy_config_q1')}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={marksPaymentsInBooksy === true ? 'primary' : 'outline'}
                    onClick={() => setMarksPaymentsInBooksy(true)}
                    className="flex-1"
                  >
                    {t('common.yes')}
                  </Button>
                  <Button
                    type="button"
                    variant={marksPaymentsInBooksy === false ? 'primary' : 'outline'}
                    onClick={() => setMarksPaymentsInBooksy(false)}
                    className="flex-1"
                  >
                    {t('common.no')}
                  </Button>
                </div>
                {marksPaymentsInBooksy === false ? (
                  <p className="text-muted-foreground text-xs leading-snug">
                    {t('integrations.booksy_config_q1_hint_no')}
                  </p>
                ) : null}
              </div>

              {/* Q2 — deletes finished visits */}
              <div className="flex flex-col gap-2">
                <Label>{t('integrations.booksy_config_q2')}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={deletesVisitsInBooksy === true ? 'primary' : 'outline'}
                    onClick={() => setDeletesVisitsInBooksy(true)}
                    className="flex-1"
                  >
                    {t('common.yes')}
                  </Button>
                  <Button
                    type="button"
                    variant={deletesVisitsInBooksy === false ? 'primary' : 'outline'}
                    onClick={() => setDeletesVisitsInBooksy(false)}
                    className="flex-1"
                  >
                    {t('common.no')}
                  </Button>
                </div>
                {deletesVisitsInBooksy === true ? (
                  <p className="text-muted-foreground text-xs leading-snug">
                    {t('integrations.booksy_config_q2_hint_yes')}
                  </p>
                ) : null}
              </div>
            </div>

            <DialogFooter className="px-5">
              <Button
                type="button"
                onClick={handleConfigSubmit}
                disabled={
                  isPending || marksPaymentsInBooksy === null || deletesVisitsInBooksy === null
                }
              >
                {updateConfig.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                    {t('integrations.saving')}
                  </>
                ) : (
                  t('integrations.save')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
