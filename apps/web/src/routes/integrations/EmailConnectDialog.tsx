import { Loader2, Mail } from 'lucide-react'
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

type Props = {
  open: boolean
  salonId: string
  onClose: () => void
}

/**
 * Email-канал: подключение через SMTP (отправка) + IMAP (приём).
 * Полная имплементация SMTP/IMAP — в следующем спринте (ADR по выбору
 * Deno-совместимой библиотеки). Этот диалог уже принимает credentials и
 * сохраняет integration='connected' через email-channel edge function.
 *
 * Для Gmail — рекомендуем app-password (Settings → Security → 2-Step
 * Verification → App passwords). С обычным паролем Google блокирует
 * IMAP с конца 2022.
 */
export function EmailConnectDialog({ open, salonId, onClose }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    user: '',
    pass: '',
  })

  async function submit() {
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-5" strokeWidth={1.8} />
            {t('integrations.email.title', { defaultValue: 'Email-канал' })}
          </DialogTitle>
          <DialogDescription>
            {t('integrations.email.subtitle', {
              defaultValue:
                'SMTP для отправки писем + IMAP для приёма. Для Gmail используй app-password.',
            })}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
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
              {t('integrations.email.field.pass', { defaultValue: 'Пароль (или app-password)' })}
            </Label>
            <Input
              id="email-pass"
              type="password"
              autoComplete="current-password"
              value={form.pass}
              onChange={(e) => setForm({ ...form, pass: e.target.value })}
              required
            />
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
            {t('integrations.email.connect_button', { defaultValue: 'Подключить' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
