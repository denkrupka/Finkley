import { Loader2, Mail } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { useStaff } from '@/hooks/useStaff'
import { supabase } from '@/lib/supabase/client'

/**
 * Модалка для отправки приглашений мастерам, импортированным из Booksy.
 *
 * Показывается после первого успешного catalog sync — когда есть staff с
 * external_source='booksy' и invite_sent_at IS NULL. Юзер видит список,
 * может снять галочки или дописать email там где Booksy его не отдал.
 * Подключается к существующему send-invitation edge function (role='staff').
 */
export function BooksyStaffInviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: allStaff = [] } = useStaff(salonId, { activeOnly: true })

  // Только мастера из Booksy без отправленного invite
  const candidates = useMemo(
    () =>
      allStaff.filter(
        (s) => s.external_source === 'booksy' && s.invite_sent_at === null && s.is_active,
      ),
    [allStaff],
  )

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    // Инициализация: все галочки включены по умолчанию, email префиллится из staff.email
    const sel: Record<string, boolean> = {}
    const em: Record<string, string> = {}
    for (const s of candidates) {
      sel[s.id] = true
      em[s.id] = s.email ?? ''
    }
    setSelected(sel)
    setEmails(em)
  }, [open, candidates])

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function updateEmail(id: string, value: string) {
    setEmails((prev) => ({ ...prev, [id]: value }))
  }

  async function handleSend() {
    if (!salonId) return
    const toSend = candidates.filter((s) => selected[s.id])
    const withoutEmail = toSend.filter((s) => !emails[s.id]?.trim())
    if (withoutEmail.length > 0) {
      toast.error(t('integrations.booksy_invite.errors.emails_required'))
      return
    }
    setPending(true)
    let okCount = 0
    let failCount = 0
    for (const s of toSend) {
      const email = (emails[s.id] ?? '').trim()
      try {
        const { data, error } = await supabase.functions.invoke('send-invitation', {
          body: {
            action: 'create',
            salon_id: salonId,
            email,
            role: 'staff',
            staff_id: s.id,
            invited_first_name: s.full_name.split(' ')[0] ?? '',
            invited_last_name: s.full_name.split(' ').slice(1).join(' '),
          },
        })
        if (error) {
          failCount++
          continue
        }
        const json = data as { ok?: boolean }
        if (json?.ok) {
          okCount++
          // Помечаем locally invite_sent_at
          await supabase
            .from('staff')
            .update({ invite_sent_at: new Date().toISOString() })
            .eq('id', s.id)
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }
    setPending(false)
    if (okCount > 0) {
      toast.success(t('integrations.booksy_invite.sent', { count: okCount }))
    }
    if (failCount > 0) {
      toast.error(t('integrations.booksy_invite.errors.send_failed', { count: failCount }))
    }
    onClose()
  }

  if (candidates.length === 0) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(560px,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>{t('integrations.booksy_invite.title')}</DialogTitle>
          <DialogDescription>{t('integrations.booksy_invite.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-5 pb-2 pt-3">
          {candidates.map((s) => (
            <div
              key={s.id}
              className="border-border bg-card flex items-center gap-3 rounded-md border p-2.5"
            >
              <input
                type="checkbox"
                checked={!!selected[s.id]}
                onChange={() => toggle(s.id)}
                className="size-4 shrink-0"
                id={`inv-${s.id}`}
              />
              <label
                htmlFor={`inv-${s.id}`}
                className="text-foreground w-[140px] shrink-0 cursor-pointer text-sm font-semibold"
              >
                {s.full_name}
              </label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={emails[s.id] ?? ''}
                onChange={(e) => updateEmail(s.id, e.target.value)}
                className="h-9 flex-1 text-sm"
                disabled={!selected[s.id]}
              />
            </div>
          ))}
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            {t('integrations.booksy_invite.hint')}
          </p>
        </div>

        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
            {t('integrations.booksy_invite.skip')}
          </Button>
          <Button type="button" onClick={handleSend} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                {t('integrations.booksy_invite.sending')}
              </>
            ) : (
              <>
                <Mail className="size-4" strokeWidth={1.7} />
                {t('integrations.booksy_invite.send')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
