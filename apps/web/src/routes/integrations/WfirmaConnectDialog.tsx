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
import { useWfirmaConnectWithCredentials, useWfirmaConnectWithLogin } from '@/hooks/useIntegrations'

/**
 * WfirmaConnectDialog — Hybrid X3 (см. ADR-012):
 *   - Tab «Быстро»: email+password от wfirma.pl → edge function реверсит
 *     UI и достаёт пару accessKey/secretKey. Дефолт.
 *   - Tab «Вручную»: 3 поля access/secret/companyId — для юзеров с 2FA или
 *     если auto-login сломался.
 */
export function WfirmaConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [mode, setMode] = useState<'quick' | 'manual'>('quick')

  // Quick (X2)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Manual (X1)
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [companyId, setCompanyId] = useState('')

  const connectQuick = useWfirmaConnectWithLogin(salonId)
  const connectManual = useWfirmaConnectWithCredentials(salonId)
  const isPending = connectQuick.isPending || connectManual.isPending

  useEffect(() => {
    if (!open) {
      setMode('quick')
      setEmail('')
      setPassword('')
      setAccessKey('')
      setSecretKey('')
      setCompanyId('')
    }
  }, [open])

  function explainError(code: string): string {
    switch (code) {
      case 'wfirma_login_failed':
        return t('integrations.errors.wfirma_login_failed')
      case 'wfirma_no_companies':
        return t('integrations.errors.wfirma_no_companies')
      case 'wfirma_form_changed':
        return t('integrations.errors.wfirma_form_changed')
      case 'wfirma_captcha':
        return t('integrations.errors.wfirma_captcha')
      case 'wfirma_keygen_failed':
        return t('integrations.errors.wfirma_keygen_failed')
      case 'wfirma_invalid_credentials':
        return t('integrations.errors.wfirma_invalid_credentials')
      case 'wfirma_company_id_not_found':
        return t('integrations.errors.wfirma_company_id_not_found')
      case 'invalid_keys_format':
        return t('integrations.errors.wfirma_invalid_keys_format')
      case 'invalid_company_id':
        return t('integrations.errors.wfirma_invalid_company_id')
      case 'auto_login_disabled':
        return t('integrations.errors.wfirma_auto_login_disabled')
      default:
        return code
    }
  }

  function handleQuickSubmit() {
    if (!email.trim() || !password) {
      toast.error(t('integrations.errors.fields_required'))
      return
    }
    connectQuick.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (res) => {
          toast.success(t('integrations.toast_connected', { name: res.company.name }))
          onClose()
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : String(err)
          toast.error(explainError(code))
          // Если автологин завалился — мягкий толчок к ручному вводу
          if (
            code === 'wfirma_login_failed' ||
            code === 'wfirma_form_changed' ||
            code === 'wfirma_captcha' ||
            code === 'auto_login_disabled'
          ) {
            setMode('manual')
          }
        },
      },
    )
  }

  function handleManualSubmit() {
    const a = accessKey.trim()
    const s = secretKey.trim()
    const c = companyId.trim()
    if (!a || !s || !c) {
      toast.error(t('integrations.errors.fields_required'))
      return
    }
    connectManual.mutate(
      { accessKey: a, secretKey: s, companyId: c },
      {
        onSuccess: (res) => {
          toast.success(t('integrations.toast_connected', { name: res.company.name }))
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
          <DialogTitle>{t('integrations.connect_title', { name: 'wFirma' })}</DialogTitle>
          <DialogDescription>{t('integrations.wfirma.dialog_subtitle')}</DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="bg-muted/40 mx-5 mt-2 inline-flex rounded-md p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('quick')}
            className={`rounded-sm px-3 py-1.5 font-semibold transition-colors ${
              mode === 'quick' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {t('integrations.wfirma.tab_quick')}
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`rounded-sm px-3 py-1.5 font-semibold transition-colors ${
              mode === 'manual' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {t('integrations.wfirma.tab_manual')}
          </button>
        </div>

        {mode === 'quick' ? (
          <form
            className="flex flex-col gap-4 px-5 pb-2 pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              handleQuickSubmit()
            }}
          >
            <p className="text-muted-foreground text-xs">
              {t('integrations.wfirma.quick_subtitle')}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-email">{t('integrations.fields.email')}</Label>
              <Input
                id="wf-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-password">{t('integrations.fields.password')}</Label>
              <Input
                id="wf-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="border-secondary/30 bg-secondary/5 flex items-start gap-2 rounded-md border p-3">
              <Lock className="text-secondary mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
              <p className="text-foreground/80 text-xs leading-snug">
                {t('integrations.wfirma.security_note')}
              </p>
            </div>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4 px-5 pb-2 pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              handleManualSubmit()
            }}
          >
            <ol className="text-muted-foreground list-decimal pl-4 text-xs leading-snug">
              <li>{t('integrations.wfirma.manual_step1')}</li>
              <li>{t('integrations.wfirma.manual_step2')}</li>
              <li>{t('integrations.wfirma.manual_step3')}</li>
              <li>{t('integrations.wfirma.manual_step4')}</li>
            </ol>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-access">{t('integrations.fields.access_key')}</Label>
              <Input
                id="wf-access"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="32 hex symbols"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-secret">{t('integrations.fields.secret_key')}</Label>
              <Input
                id="wf-secret"
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="32 hex symbols"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-company">{t('integrations.fields.company_id')}</Label>
              <Input
                id="wf-company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="884136"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-[11px] leading-snug">
                {t('integrations.wfirma.manual_company_id_hint')}
              </p>
            </div>
          </form>
        )}

        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={mode === 'quick' ? handleQuickSubmit : handleManualSubmit}
            disabled={isPending}
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
      </DialogContent>
    </Dialog>
  )
}
