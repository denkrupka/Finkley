import { Calendar, Mail, Pencil, Phone, Save, User as UserIcon, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateMemberProfile, type TeamMember } from '@/hooks/useTeam'

/**
 * Карточка участника команды — клик по строке в /salon/settings/team.
 *
 * Owner/admin может редактировать имя/фамилию/телефон члена. Email менять
 * нельзя отсюда (требует auth-flow, доступно только super-admin порталу).
 *
 * Для «себя» (current user смотрит свою карточку) — редактирование тоже
 * разрешено, потому что юзер всё равно может изменить profile через RLS.
 */
export function MemberCardModal({
  member,
  salonId,
  canEdit,
  onClose,
}: {
  member: TeamMember
  salonId: string | undefined
  canEdit: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateMemberProfile(salonId)
  const [editing, setEditing] = useState(false)

  const [firstName, ...rest] = (member.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  const lastName = rest.join(' ')
  const [draft, setDraft] = useState({
    first_name: firstName ?? '',
    last_name: lastName ?? '',
    phone: member.phone ?? '',
  })

  function save() {
    update.mutate(
      {
        target_user_id: member.user_id,
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        phone: draft.phone.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t('team.member_card.toast_saved'))
          setEditing(false)
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  const displayName = member.full_name?.trim() || member.invited_email || member.user_id.slice(0, 8)

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="bg-brand-navy/10 text-brand-navy grid size-9 place-items-center rounded-full">
              <UserIcon className="size-4" strokeWidth={2} />
            </div>
            <span className="truncate">{displayName}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                ROLE_TONE[member.role] ?? 'bg-slate-100 text-slate-700'
              }`}
            >
              {t(`roles.${member.role}`, { defaultValue: member.role })}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                {t('team.member_card.contacts')}
              </h3>
              {canEdit && !editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-semibold"
                >
                  <Pencil className="size-3" strokeWidth={2} />
                  {t('team.member_card.edit')}
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">{t('team.member_card.first_name')}</Label>
                  <Input
                    value={draft.first_name}
                    onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))}
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('team.member_card.last_name')}</Label>
                  <Input
                    value={draft.last_name}
                    onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))}
                    className="mt-1 h-9"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">{t('team.member_card.phone')}</Label>
                  <Input
                    value={draft.phone}
                    onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                    placeholder="+48 ..."
                    className="mt-1 h-9"
                  />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button variant="primary" size="sm" disabled={update.isPending} onClick={save}>
                    <Save className="size-3.5" strokeWidth={2} />
                    {t('common.save')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false)
                      setDraft({
                        first_name: firstName ?? '',
                        last_name: lastName ?? '',
                        phone: member.phone ?? '',
                      })
                    }}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 text-sm">
                {member.invited_email ? (
                  <div className="flex items-center gap-2">
                    <Mail className="text-muted-foreground size-3.5" strokeWidth={1.8} />
                    <span className="truncate">{member.invited_email}</span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Phone className="text-muted-foreground size-3.5" strokeWidth={1.8} />
                  <span>{member.phone || '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="text-muted-foreground size-3.5" strokeWidth={1.8} />
                  <span className="text-muted-foreground text-xs">
                    {member.joined_at
                      ? t('team.member_since', {
                          date: new Date(member.joined_at).toLocaleDateString('ru-RU'),
                        })
                      : '—'}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const ROLE_TONE: Record<string, string> = {
  owner: 'bg-violet-100 text-violet-700',
  admin: 'bg-sky-100 text-sky-700',
  accountant: 'bg-emerald-100 text-emerald-700',
  staff: 'bg-slate-100 text-slate-700',
}
