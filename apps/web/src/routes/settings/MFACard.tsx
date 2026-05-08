import { Loader2, Shield, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useEnrollTOTP, useMFAFactors, useUnenrollMFA, useVerifyEnrollment } from '@/hooks/useMFA'

export function MFACard() {
  const { t } = useTranslation()
  const { data: factors = [], isLoading } = useMFAFactors()
  const enroll = useEnrollTOTP()
  const verify = useVerifyEnrollment()
  const unenroll = useUnenrollMFA()

  const [enrollDialog, setEnrollDialog] = useState<{
    factorId: string
    qrCode: string
    secret: string
  } | null>(null)
  const [code, setCode] = useState('')

  const verifiedTotp = factors.filter((f) => f.factor_type === 'totp' && f.status === 'verified')

  if (isLoading) return null

  function startEnrollment() {
    enroll.mutate('Finkley TOTP', {
      onSuccess: (res) => {
        setEnrollDialog({ factorId: res.factorId, qrCode: res.qrCode, secret: res.secret })
        setCode('')
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  function submitCode() {
    if (!enrollDialog) return
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error(t('settings.mfa.invalid_code'))
      return
    }
    verify.mutate(
      { factorId: enrollDialog.factorId, code: code.trim() },
      {
        onSuccess: () => {
          toast.success(t('settings.mfa.toast_enabled'))
          setEnrollDialog(null)
          setCode('')
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="flex items-start gap-3">
        <span
          className={
            'grid size-9 shrink-0 place-items-center rounded-md ' +
            (verifiedTotp.length > 0
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-muted text-muted-foreground')
          }
          aria-hidden
        >
          {verifiedTotp.length > 0 ? (
            <ShieldCheck className="size-4" strokeWidth={1.8} />
          ) : (
            <Shield className="size-4" strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-brand-navy text-base font-bold">{t('settings.mfa.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-snug">
            {verifiedTotp.length > 0
              ? t('settings.mfa.subtitle_enabled')
              : t('settings.mfa.subtitle_disabled')}
          </p>
        </div>
      </div>

      {verifiedTotp.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {verifiedTotp.map((f) => (
            <div
              key={f.id}
              className="border-border bg-muted/30 flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm font-semibold">
                  {f.friendly_name ?? 'TOTP'}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('settings.mfa.added', {
                    date: new Date(f.created_at).toLocaleDateString('ru-RU'),
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!confirm(t('settings.mfa.confirm_remove'))) return
                  unenroll.mutate(f.id, {
                    onSuccess: () => toast.success(t('settings.mfa.toast_disabled')),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }}
                disabled={unenroll.isPending}
                className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md disabled:opacity-50"
                aria-label={t('settings.mfa.remove_aria')}
              >
                <Trash2 className="size-4" strokeWidth={1.7} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        {verifiedTotp.length === 0 ? (
          <Button onClick={startEnrollment} disabled={enroll.isPending}>
            {enroll.isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <ShieldCheck className="size-4" strokeWidth={1.8} />
            )}
            {t('settings.mfa.enable')}
          </Button>
        ) : null}
      </div>

      {/* Enrollment dialog */}
      <Dialog open={!!enrollDialog} onOpenChange={(o) => !o && setEnrollDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.mfa.enroll_title')}</DialogTitle>
            <DialogDescription>{t('settings.mfa.enroll_subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-5 pb-2 pt-3">
            <ol className="text-foreground/80 list-decimal pl-5 text-xs leading-relaxed">
              <li>{t('settings.mfa.step1')}</li>
              <li>{t('settings.mfa.step2')}</li>
              <li>{t('settings.mfa.step3')}</li>
            </ol>

            {enrollDialog ? (
              <>
                <div
                  className="bg-card border-border rounded-md border p-3"
                  // QR returned by Supabase already SVG; render inline.
                  dangerouslySetInnerHTML={{ __html: enrollDialog.qrCode }}
                />
                <div>
                  <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                    {t('settings.mfa.manual_secret')}
                  </Label>
                  <p className="num text-foreground bg-muted/30 mt-1 break-all rounded-md border border-dashed px-3 py-2 text-xs">
                    {enrollDialog.secret}
                  </p>
                </div>
              </>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mfa-code">{t('settings.mfa.code_label')}</Label>
              <Input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="num text-center text-2xl tracking-widest"
                autoComplete="one-time-code"
              />
            </div>
          </div>
          <DialogFooter className="px-5">
            <Button
              variant="outline"
              type="button"
              onClick={() => setEnrollDialog(null)}
              disabled={verify.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={submitCode} disabled={verify.isPending || code.length !== 6}>
              {verify.isPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <ShieldCheck className="size-4" strokeWidth={1.8} />
              )}
              {t('settings.mfa.verify')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export { ShieldOff } // for type-only export hint
