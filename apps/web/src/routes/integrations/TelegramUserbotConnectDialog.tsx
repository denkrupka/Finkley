/**
 * Диалог подключения личного TG-аккаунта (userbot, ADR-015).
 *
 * Шаги:
 *  1. phone — POST /auth/start, на телефон приходит SMS с кодом
 *  2. code  — POST /auth/code → state=done или awaiting_2fa
 *  3. 2fa   — POST /auth/2fa → state=done
 *
 * Состояния: 'phone' | 'code' | '2fa' | 'done'. На done — закрываем диалог,
 * tg_sessions автоматически обновится (refetchInterval=5s в useTgSessions).
 */
import { Loader2, Phone, Send, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import {
  useTgAuth2FA,
  useTgAuthCode,
  useTgAuthStart,
  type AuthDoneResp,
} from '@/hooks/useTgUserbot'

type Step = 'phone' | 'code' | '2fa' | 'done'

export function TelegramUserbotConnectDialog({
  open,
  salonId,
  onClose,
}: {
  open: boolean
  salonId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const startMut = useTgAuthStart()
  const codeMut = useTgAuthCode()
  const tfaMut = useTgAuth2FA()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [authFlowId, setAuthFlowId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [done, setDone] = useState<AuthDoneResp | null>(null)

  useEffect(() => {
    if (!open) {
      setStep('phone')
      setPhone('')
      setAuthFlowId(null)
      setCode('')
      setPassword('')
      setDone(null)
    }
  }, [open])

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim()) return
    startMut.mutate(
      { salon_id: salonId, phone: phone.trim() },
      {
        onSuccess: (r) => {
          setAuthFlowId(r.auth_flow_id)
          setStep('code')
          toast.success(t('integrations.telegram_userbot.code_sent'))
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (!authFlowId || !code.trim()) return
    codeMut.mutate(
      { auth_flow_id: authFlowId, code: code.trim() },
      {
        onSuccess: (r) => {
          if (r.state === 'awaiting_2fa') {
            setStep('2fa')
          } else {
            setDone(r)
            setStep('done')
            toast.success(t('integrations.telegram_userbot.connected'))
            setTimeout(onClose, 1500)
          }
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  async function submit2FA(e: React.FormEvent) {
    e.preventDefault()
    if (!authFlowId || !password) return
    tfaMut.mutate(
      { auth_flow_id: authFlowId, password },
      {
        onSuccess: (r) => {
          setDone(r)
          setStep('done')
          toast.success(t('integrations.telegram_userbot.connected'))
          setTimeout(onClose, 1500)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  const pending = startMut.isPending || codeMut.isPending || tfaMut.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:!w-[480px] sm:!max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="grid size-8 place-items-center rounded-md text-white"
              style={{ background: '#229ED9' }}
            >
              <Send className="size-4" strokeWidth={1.8} />
            </span>
            {t('integrations.telegram_userbot.title')}
          </DialogTitle>
          <DialogDescription className="leading-snug">
            {t('integrations.telegram_userbot.subtitle')}
          </DialogDescription>
        </DialogHeader>

        {/* Юридическое предупреждение про TG ToS */}
        {step === 'phone' ? (
          <div className="border-brand-yellow-deep/40 bg-brand-yellow/30 flex items-start gap-2 rounded-md border p-3 text-xs">
            <ShieldAlert className="text-brand-navy mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <div className="text-brand-navy">
              <p className="font-bold">{t('integrations.telegram_userbot.warning_title')}</p>
              <p className="mt-1 leading-relaxed">
                {t('integrations.telegram_userbot.warning_body')}
              </p>
            </div>
          </div>
        ) : null}

        {step === 'phone' && (
          <form className="flex flex-col gap-3" onSubmit={submitPhone}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tg-phone">{t('integrations.telegram_userbot.phone_label')}</Label>
              <div className="border-border bg-card flex items-center gap-2 rounded-md border px-3">
                <Phone className="text-muted-foreground size-4" strokeWidth={1.8} />
                <input
                  id="tg-phone"
                  type="tel"
                  placeholder="+48501234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  pattern="^\+[1-9]\d{6,14}$"
                  className="num h-11 flex-1 bg-transparent text-sm tabular-nums outline-none"
                  autoFocus
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {t('integrations.telegram_userbot.phone_hint')}
              </p>
            </div>
            <DialogFooter className="mt-2 flex-row justify-end gap-2 px-0">
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={pending || !phone}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('integrations.telegram_userbot.send_code')}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'code' && (
          <form className="flex flex-col gap-3" onSubmit={submitCode}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tg-code">{t('integrations.telegram_userbot.code_label')}</Label>
              <Input
                id="tg-code"
                type="text"
                inputMode="numeric"
                pattern="^[0-9]{5,6}$"
                placeholder="12345"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                maxLength={6}
                className="num text-center text-lg tabular-nums tracking-widest"
              />
              <p className="text-muted-foreground text-xs">
                {t('integrations.telegram_userbot.code_hint', { phone })}
              </p>
            </div>
            <DialogFooter className="mt-2 flex-row justify-end gap-2 px-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('phone')}
                disabled={pending}
              >
                {t('common.back')}
              </Button>
              <Button type="submit" disabled={pending || code.length < 5}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('common.confirm')}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === '2fa' && (
          <form className="flex flex-col gap-3" onSubmit={submit2FA}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tg-password">
                {t('integrations.telegram_userbot.password_label')}
              </Label>
              <Input
                id="tg-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              <p className="text-muted-foreground text-xs">
                {t('integrations.telegram_userbot.password_hint')}
              </p>
            </div>
            <DialogFooter className="mt-2 flex-row justify-end gap-2 px-0">
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={pending || !password}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('integrations.telegram_userbot.connect')}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'done' && done && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              ✓
            </span>
            <p className="text-foreground text-sm font-semibold">
              {t('integrations.telegram_userbot.done_title')}
            </p>
            <p className="text-muted-foreground text-xs">
              {done.tg_username
                ? `@${done.tg_username}`
                : `${done.tg_first_name ?? ''} (id ${done.tg_user_id})`}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
