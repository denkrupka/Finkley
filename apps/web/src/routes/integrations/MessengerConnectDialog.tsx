import { Facebook, Instagram, Loader2, MessageCircle, Phone, Send } from 'lucide-react'
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
import { useConnectMessenger, useStartOAuth, type MessengerChannel } from '@/hooks/useMessenger'

const META: Record<
  Exclude<MessengerChannel, 'internal'>,
  { name: string; icon: typeof Send; color: string }
> = {
  telegram: { name: 'Telegram', icon: Send, color: '#229ED9' },
  whatsapp: { name: 'WhatsApp Business', icon: Phone, color: '#25D366' },
  instagram: { name: 'Instagram Direct', icon: Instagram, color: '#E4405F' },
  facebook: { name: 'Facebook Messenger', icon: Facebook, color: '#1877F2' },
}

type Props = {
  open: boolean
  channel: Exclude<MessengerChannel, 'internal'> | null
  salonId: string
  onClose: () => void
}

export function MessengerConnectDialog({ open, channel, salonId, onClose }: Props) {
  const { t } = useTranslation()
  const connect = useConnectMessenger(salonId)
  const startOAuth = useStartOAuth(salonId)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [showManual, setShowManual] = useState(false)

  if (!channel) return null
  const meta = META[channel]
  const Icon = meta.icon
  const isMetaOAuth = channel === 'facebook' || channel === 'instagram'

  function handleOAuth() {
    if (!isMetaOAuth) return
    startOAuth.mutate(channel as 'facebook' | 'instagram', {
      onSuccess: (authorizeUrl) => {
        window.location.href = authorizeUrl
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  function set(key: string, val: string) {
    setFields((prev) => ({ ...prev, [key]: val }))
  }

  function submit() {
    if (!channel) return
    let credentials: Record<string, string> = {}
    if (channel === 'telegram') {
      credentials = { bot_token: (fields.bot_token ?? '').trim() }
    } else if (channel === 'whatsapp') {
      credentials = {
        phone_number_id: (fields.phone_number_id ?? '').trim(),
        access_token: (fields.access_token ?? '').trim(),
        // verify_token не запрашиваем у юзера — backend генерирует случайный.
      }
    } else {
      credentials = {
        page_id: (fields.page_id ?? '').trim(),
        page_access_token: (fields.page_access_token ?? '').trim(),
      }
    }

    const required: Record<Exclude<typeof channel, null>, string[]> = {
      telegram: ['bot_token'],
      whatsapp: ['phone_number_id', 'access_token'],
      instagram: ['page_id', 'page_access_token'],
      facebook: ['page_id', 'page_access_token'],
    }
    for (const k of required[channel]) {
      if (!credentials[k]) {
        toast.error(
          t('integrations.messengers.errors.required_field', {
            field: t(`integrations.messengers.field.${k}`, { defaultValue: k }),
          }),
        )
        return
      }
    }

    connect.mutate(
      { channel, credentials },
      {
        onSuccess: (r) => {
          toast.success(
            r.status === 'connected'
              ? t('integrations.messengers.toast_connected', { name: meta.name })
              : t('integrations.messengers.toast_saved_pending', { name: meta.name }),
          )
          setFields({})
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="grid size-8 place-items-center rounded-md"
              style={{ background: meta.color, color: 'white' }}
            >
              <Icon className="size-4" strokeWidth={1.8} />
            </span>
            {t('integrations.messengers.connect_title', { name: meta.name })}
          </DialogTitle>
          <DialogDescription>
            {t(`integrations.messengers.${channel}_help`, {
              defaultValue: t('integrations.messengers.generic_help'),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 pb-2 pt-2">
          {isMetaOAuth ? (
            <>
              <Button
                variant="primary"
                onClick={handleOAuth}
                disabled={startOAuth.isPending}
                className="h-11 w-full"
                style={{ background: meta.color }}
              >
                {startOAuth.isPending ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Icon className="size-4" strokeWidth={1.8} />
                )}
                {t('integrations.messengers.oauth_login', { name: meta.name })}
              </Button>
              <p className="text-muted-foreground text-center text-xs">
                {t('integrations.messengers.oauth_hint')}
              </p>
              <button
                type="button"
                onClick={() => setShowManual((v) => !v)}
                className="text-muted-foreground self-center text-xs underline"
              >
                {showManual
                  ? t('integrations.messengers.hide_manual')
                  : t('integrations.messengers.show_manual')}
              </button>
            </>
          ) : null}
          {channel === 'telegram' ? (
            <FieldInput
              labelKey="integrations.messengers.field.bot_token"
              hintKey="integrations.messengers.hint.bot_token"
              value={fields.bot_token ?? ''}
              onChange={(v) => set('bot_token', v)}
              placeholder="123456789:ABC-DEF1234..."
              type="password"
            />
          ) : channel === 'whatsapp' ? (
            <>
              <div className="border-brand-sage-soft bg-brand-sage-soft/15 rounded-md border p-3 text-xs">
                <p className="text-brand-sage-deep mb-2 font-bold">
                  {t('integrations.messengers.whatsapp_steps_title')}
                </p>
                <ol className="text-foreground/80 list-inside list-decimal space-y-1 leading-relaxed">
                  <li>
                    {t('integrations.messengers.whatsapp_step1')}{' '}
                    <a
                      href="https://business.facebook.com/wa/manage/phone-numbers/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-navy font-semibold underline"
                    >
                      business.facebook.com → WhatsApp → Phone Numbers
                    </a>
                  </li>
                  <li>
                    {t('integrations.messengers.whatsapp_step2')}{' '}
                    <a
                      href="https://developers.facebook.com/apps/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-navy font-semibold underline"
                    >
                      developers.facebook.com → твоё App → WhatsApp → API Setup
                    </a>
                  </li>
                </ol>
              </div>
              <FieldInput
                labelKey="integrations.messengers.field.phone_number_id"
                hintKey="integrations.messengers.hint.phone_number_id"
                value={fields.phone_number_id ?? ''}
                onChange={(v) => set('phone_number_id', v)}
                placeholder="100123..."
              />
              <FieldInput
                labelKey="integrations.messengers.field.access_token"
                hintKey="integrations.messengers.hint.access_token"
                value={fields.access_token ?? ''}
                onChange={(v) => set('access_token', v)}
                placeholder="EAA..."
                type="password"
              />
              {/* verify_token больше не показываем — auto-generate на бэкенде. */}
            </>
          ) : showManual ? (
            <>
              <FieldInput
                labelKey="integrations.messengers.field.page_id"
                hintKey="integrations.messengers.hint.page_id"
                value={fields.page_id ?? ''}
                onChange={(v) => set('page_id', v)}
                placeholder="12345678901"
              />
              <FieldInput
                labelKey="integrations.messengers.field.page_access_token"
                hintKey="integrations.messengers.hint.page_access_token"
                value={fields.page_access_token ?? ''}
                onChange={(v) => set('page_access_token', v)}
                placeholder="EAA..."
                type="password"
              />
            </>
          ) : null}

          {channel === 'whatsapp' ? (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              {t('integrations.messengers.meta_pending_note')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={connect.isPending}>
            {t('common.cancel')}
          </Button>
          {!isMetaOAuth || showManual ? (
            <Button variant="primary" onClick={submit} disabled={connect.isPending}>
              {connect.isPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <MessageCircle className="size-4" strokeWidth={1.8} />
              )}
              {t('integrations.messengers.connect_button')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FieldInput({
  labelKey,
  hintKey,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  labelKey: string
  hintKey: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password'
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-semibold">{t(labelKey)}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 text-sm"
        autoComplete="off"
      />
      <p className="text-muted-foreground text-[11px]">{t(hintKey)}</p>
    </div>
  )
}
