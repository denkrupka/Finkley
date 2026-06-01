import { Loader2, Mail, Lock, Settings as SettingsIcon } from 'lucide-react'
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
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

type Props = {
  open: boolean
  salonId: string
  onClose: () => void
}

/**
 * Email-канал: подключение через Gmail OAuth ИЛИ SMTP/IMAP.
 *
 * Tab 1 — Gmail OAuth: безопасный flow через Google. На стороне Finkley
 *   нужен Client ID + Secret в Google Cloud Console (production scope
 *   review ~1-2 нед). До production-доступа — disabled state с инструкцией.
 *
 * Tab 2 — SMTP/IMAP: ручной ввод host/port/user/pass. Работает с любым
 *   почтовым провайдером. Для Gmail — app-password (Settings → Security
 *   → 2-Step Verification → App passwords), обычный пароль Google
 *   блокирует с конца 2022.
 *
 * Юзер #37 (2026-05-XX): «Поправь модалку, сделай что бы все видно было.
 * Сделай подвкладки: Gmail | SMTP\IMAP».
 */
export function EmailConnectDialog({ open, salonId, onClose }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'oauth' | 'smtp'>('smtp')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    user: '',
    pass: '',
  })

  async function submitSmtp() {
    if (!form.user || !form.pass) {
      toast.error(t('integrations.errors.fields_required'))
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('email-channel', {
        body: {
          action: 'connect',
          salon_id: salonId,
          smtp: {
            host: form.smtpHost,
            port: Number(form.smtpPort),
            user: form.user,
            pass: form.pass,
            secure: Number(form.smtpPort) === 465,
          },
          imap: {
            host: form.imapHost,
            port: Number(form.imapPort),
            user: form.user,
            pass: form.pass,
            secure: true,
          },
        },
      })
      if (error) throw error
      const res = data as { ok?: boolean; note?: string; error?: string } | null
      if (!res?.ok) throw new Error(res?.error ?? 'connect_failed')
      toast.success(
        res.note ??
          t('integrations.email.toast_connected', { defaultValue: 'Email-канал подключён' }),
      )
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitOAuth() {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('email-channel', {
        body: { action: 'oauth_start', salon_id: salonId },
      })
      if (error) throw error
      const res = data as { ok?: boolean; url?: string; error?: string } | null
      if (res?.url) {
        window.location.href = res.url
        return
      }
      throw new Error(res?.error ?? 'oauth_not_configured')
    } catch (e) {
      // Production OAuth setup ещё не настроен в Google Cloud Console.
      // Юзер видит понятное сообщение вместо stacktrace.
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'oauth_not_configured') {
        toast.error(
          t('integrations.email.oauth_pending', {
            defaultValue:
              'Gmail OAuth ещё не активен — пока что используй вкладку SMTP/IMAP с app-password',
          }),
        )
      } else {
        toast.error(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:!max-w-[560px]">
        <div className="border-border shrink-0 border-b px-5 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="size-5" strokeWidth={1.8} />
              {t('integrations.email.title', { defaultValue: 'Email-канал' })}
            </DialogTitle>
            <DialogDescription>
              {t('integrations.email.subtitle', {
                defaultValue: 'Подключи Gmail через OAuth или ручные SMTP/IMAP credentials.',
              })}
            </DialogDescription>
          </DialogHeader>

          {/* Tabs — Gmail OAuth | SMTP/IMAP. Юзер #37: «Сделай подвкладки» */}
          <div className="border-border bg-card mt-4 grid grid-cols-2 rounded-md border p-1">
            <button
              type="button"
              onClick={() => setTab('oauth')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-xs font-semibold transition-colors',
                tab === 'oauth'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Lock className="size-3.5" strokeWidth={1.8} />
              Gmail OAuth
            </button>
            <button
              type="button"
              onClick={() => setTab('smtp')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-xs font-semibold transition-colors',
                tab === 'smtp'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <SettingsIcon className="size-3.5" strokeWidth={1.8} />
              SMTP / IMAP
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'oauth' ? (
            <div className="flex flex-col gap-4">
              <div className="border-brand-teal-deep/30 bg-brand-teal-light/40 rounded-md border-[1.5px] p-4">
                <p className="text-foreground text-sm font-semibold">
                  {t('integrations.email.oauth_title', {
                    defaultValue: 'Войти через Google',
                  })}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('integrations.email.oauth_desc', {
                    defaultValue:
                      'Безопасный flow без передачи пароля: Google спросит твоё согласие и вернёт токен только для отправки/чтения email. Токен в любой момент отзывается из настроек Google-аккаунта.',
                  })}
                </p>
                <Button
                  onClick={submitOAuth}
                  disabled={busy}
                  className="mt-3 w-full"
                  variant="primary"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Lock className="size-4" strokeWidth={1.8} />
                  )}
                  {t('integrations.email.oauth_button', {
                    defaultValue: 'Подключить через Google',
                  })}
                </Button>
              </div>
              <p className="text-muted-foreground text-[11px]">
                {t('integrations.email.oauth_hint', {
                  defaultValue:
                    'Если OAuth ещё не доступен, используй вкладку SMTP/IMAP с app-password Google.',
                })}
              </p>
            </div>
          ) : (
            <form
              className="grid grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                submitSmtp()
              }}
            >
              <div className="col-span-2">
                <Label htmlFor="email-user">
                  {t('integrations.email.field.user', { defaultValue: 'Email' })}
                </Label>
                <Input
                  id="email-user"
                  type="email"
                  autoComplete="email"
                  value={form.user}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="email-pass">
                  {t('integrations.email.field.pass', {
                    defaultValue: 'Пароль (или app-password)',
                  })}
                </Label>
                <Input
                  id="email-pass"
                  type="password"
                  autoComplete="current-password"
                  value={form.pass}
                  onChange={(e) => setForm({ ...form, pass: e.target.value })}
                  required
                />
                <p className="text-muted-foreground mt-1 text-[10px]">
                  {t('integrations.email.gmail_hint', {
                    defaultValue:
                      'Gmail требует app-password: myaccount.google.com → Security → 2-Step Verification → App passwords',
                  })}
                </p>
              </div>
              <div>
                <Label htmlFor="smtp-host">SMTP host</Label>
                <Input
                  id="smtp-host"
                  value={form.smtpHost}
                  onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="smtp-port">SMTP port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => setForm({ ...form, smtpPort: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="imap-host">IMAP host</Label>
                <Input
                  id="imap-host"
                  value={form.imapHost}
                  onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="imap-port">IMAP port</Label>
                <Input
                  id="imap-port"
                  type="number"
                  value={form.imapPort}
                  onChange={(e) => setForm({ ...form, imapPort: e.target.value })}
                />
              </div>
            </form>
          )}
        </div>

        <DialogFooter className="border-border shrink-0 border-t px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {tab === 'smtp' ? (
            <Button onClick={submitSmtp} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
              {t('integrations.email.connect_button', { defaultValue: 'Подключить' })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
