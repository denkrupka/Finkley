import { Loader2, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { useKsefConnect } from '@/hooks/useIntegrations'
import { consumeOnboardingCredentials } from '@/lib/onboarding-credentials'

/**
 * KsefConnectDialog — прямой коннект к Krajowy System e-Faktur через token
 * из «Mój KSeF» (TASK-46, ADR-013).
 *
 * UX:
 *   - 3-step хелп: «как получить token» с пунктами для Profil Zaufany
 *   - поле NIP (10 цифр)
 *   - поле token (длинная hex-строка)
 *   - radio test/prod environment (по умолчанию test пока MVP)
 */
export function KsefConnectDialog({
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

  const [nip, setNip] = useState('')
  const [token, setToken] = useState('')

  const connect = useKsefConnect(salonId)

  useEffect(() => {
    if (!open) {
      setNip('')
      setToken('')
      return
    }
    // T150 — pre-fill credentials собранных в онбординге.
    if (salonId) {
      const creds = consumeOnboardingCredentials(salonId, 'ksef')
      if (creds) {
        if (creds.nip) setNip(creds.nip)
        if (creds.token) setToken(creds.token)
      }
    }
  }, [open, salonId])

  function explainError(code: string): string {
    switch (code) {
      case 'invalid_nip_format':
        return t('integrations.errors.ksef_invalid_nip')
      case 'invalid_token_format':
        return t('integrations.errors.ksef_invalid_token')
      case 'ksef_invalid_credentials':
        return t('integrations.errors.ksef_invalid_credentials')
      case 'ksef_challenge_failed':
        return t('integrations.errors.ksef_challenge_failed')
      case 'ksef_api_error':
        return t('integrations.errors.ksef_api_error')
      default:
        return code
    }
  }

  function handleSubmit() {
    const cleanNip = nip.replace(/[\s-]/g, '')
    if (!/^\d{10}$/.test(cleanNip)) {
      toast.error(t('integrations.errors.ksef_invalid_nip'))
      return
    }
    if (!token.trim() || token.trim().length < 32) {
      toast.error(t('integrations.errors.ksef_invalid_token'))
      return
    }
    connect.mutate(
      { nip: cleanNip, token: token.trim() },
      {
        onSuccess: () => {
          toast.success(t('integrations.toast_connected', { name: 'KSeF' }))
          onClose()
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : String(err)
          toast.error(explainError(code))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('integrations.connect_title', { name: 'KSeF' })}</DialogTitle>
          <DialogDescription>{t('integrations.ksef.dialog_subtitle')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 px-5 pb-2 pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <ol className="text-muted-foreground list-decimal pl-4 text-xs leading-snug">
            <li>{t('integrations.ksef.step1')}</li>
            <li>{t('integrations.ksef.step2')}</li>
            <li>{t('integrations.ksef.step3')}</li>
            <li>{t('integrations.ksef.step4')}</li>
          </ol>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ksef-nip">{t('integrations.fields.ksef_nip')}</Label>
            <Input
              id="ksef-nip"
              value={nip}
              onChange={(e) => setNip(e.target.value)}
              placeholder="1234567890"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ksef-token">{t('integrations.fields.ksef_token')}</Label>
            <Input
              id="ksef-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-snug">
              {t('integrations.ksef.token_hint')}
            </p>
          </div>

          <div className="border-secondary/30 bg-secondary/5 flex items-start gap-2 rounded-md border p-3">
            <Lock className="text-secondary mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
            <p className="text-foreground/80 text-xs leading-snug">
              {t('integrations.ksef.security_note')}
            </p>
          </div>
        </form>

        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={connect.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={connect.isPending}>
            {connect.isPending ? (
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
