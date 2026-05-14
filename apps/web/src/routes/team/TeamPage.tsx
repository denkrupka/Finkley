import { ArrowLeft, Loader2, Mail, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { MemberCardModal } from '@/components/team/MemberCardModal'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useStaff } from '@/hooks/useStaff'
import {
  useCancelInvitation,
  useInvitations,
  useInviteMember,
  useMyRole,
  useRemoveMember,
  useTeamMembers,
  useUpdateMemberRole,
  type SalonRole,
  type TeamMember,
} from '@/hooks/useTeam'

const ROLE_OPTIONS: { value: SalonRole; key: string }[] = [
  { value: 'admin', key: 'team.role.admin' },
  { value: 'accountant', key: 'team.role.accountant' },
  { value: 'staff', key: 'team.role.staff' },
]

/**
 * /salon/settings/team — управление командой салона.
 * Также рендерится inline на /salon/settings?tab=team (см. TeamSettingsInline).
 * В inline-режиме скрываем заголовок и back-link (внешняя страница уже их даёт).
 */
export function TeamPage({ inline = false }: { inline?: boolean } = {}) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(salonId)
  const { data: invitations = [] } = useInvitations(salonId)
  const { data: staff = [] } = useStaff(salonId)
  const { data: myRole } = useMyRole(salonId)
  const invite = useInviteMember(salonId)
  const cancelInv = useCancelInvitation(salonId)
  const updateRole = useUpdateMemberRole(salonId)
  const removeMember = useRemoveMember(salonId)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [openMember, setOpenMember] = useState<TeamMember | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<SalonRole>('staff')
  // staffId больше не задаётся в UI — auto-resolve при accept-invite
  // (см. accept_salon_invitation: если role='staff' и нет staff_id —
  // создаётся новая staff row с именем приглашённого).
  const staffId = ''
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')

  const canManage = myRole === 'owner' || myRole === 'admin'

  function submitInvite() {
    if (!email.trim()) {
      toast.error(t('team.errors.email_required'))
      return
    }
    invite.mutate(
      {
        email: email.trim(),
        role,
        staffId: role === 'staff' ? staffId || null : null,
        first_name: firstName,
        last_name: lastName,
        phone,
      },
      {
        onSuccess: () => {
          toast.success(t('team.toast_invited'))
          setInviteOpen(false)
          setEmail('')
          setRole('staff')
          setFirstName('')
          setLastName('')
          setPhone('')
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(t(`team.errors.${msg}`, msg))
        },
      },
    )
  }

  if (!salonId) return null

  return (
    <div
      className={
        inline ? 'flex flex-1 flex-col' : 'flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12'
      }
    >
      <div className="mb-5">
        {!inline ? (
          <Link
            to={`/${salonId}/settings`}
            className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            {t('team.back_to_settings')}
          </Link>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div>
            {!inline ? (
              <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
                {t('team.title')}
              </h1>
            ) : null}
            <p className="text-muted-foreground mt-1 text-sm">{t('team.subtitle')}</p>
          </div>
          {canManage ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" strokeWidth={1.8} />
              {t('team.invite_button')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Members */}
      <section className="border-border bg-card shadow-finsm mb-4 overflow-hidden rounded-lg border">
        <h2 className="border-border text-muted-foreground border-b px-5 py-3 text-[11px] font-bold uppercase tracking-wider">
          {t('team.members_title')}
        </h2>
        {membersLoading ? (
          <div className="px-5 py-6 text-center">
            <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-muted-foreground px-5 py-6 text-sm">{t('team.empty')}</p>
        ) : (
          <ul>
            {members.map((m) => {
              const linkedStaff = staff.find((s) => s.id === m.staff_id)
              const isOwner = m.role === 'owner'
              return (
                <li
                  key={m.id}
                  className="border-border grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t px-5 py-3 first:border-t-0"
                >
                  <button
                    type="button"
                    onClick={() => setOpenMember(m)}
                    className="min-w-0 cursor-pointer text-left transition-colors"
                  >
                    <p className="text-foreground hover:text-primary truncate text-sm font-semibold">
                      {m.full_name ??
                        linkedStaff?.full_name ??
                        m.invited_email ??
                        m.user_id.slice(0, 8)}
                    </p>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {(m.email ?? m.invited_email) ? (
                        <span>{m.email ?? m.invited_email}</span>
                      ) : null}
                      {m.phone ? <span>{m.phone}</span> : null}
                      <span>
                        {linkedStaff
                          ? t('team.linked_to_staff', { name: linkedStaff.full_name })
                          : t('team.member_since', {
                              date: m.joined_at
                                ? new Date(m.joined_at).toLocaleDateString('ru-RU')
                                : '—',
                            })}
                      </span>
                    </div>
                  </button>
                  {canManage && !isOwner ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        updateRole.mutate(
                          { memberId: m.id, role: v as SalonRole },
                          {
                            onSuccess: () => toast.success(t('team.toast_role_updated')),
                            onError: (err) =>
                              toast.error(err instanceof Error ? err.message : String(err)),
                          },
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {t(r.key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span
                      className={
                        'rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
                        (isOwner
                          ? 'bg-brand-yellow/40 text-brand-navy'
                          : 'bg-muted text-foreground')
                      }
                    >
                      {t(`team.role.${m.role}`)}
                    </span>
                  )}
                  {canManage && !isOwner ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(t('team.confirm_remove'))) return
                        removeMember.mutate(m.id, {
                          onSuccess: () => toast.success(t('team.toast_removed')),
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : String(err)),
                        })
                      }}
                      className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                      aria-label={t('team.remove_aria')}
                      title={t('team.remove_aria')}
                    >
                      <Trash2 className="size-4" strokeWidth={1.7} />
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Pending invitations */}
      {invitations.length > 0 ? (
        <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
          <h2 className="border-border text-muted-foreground border-b px-5 py-3 text-[11px] font-bold uppercase tracking-wider">
            {t('team.pending_title')}
          </h2>
          <ul>
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="border-border grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t px-5 py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <p className="text-foreground inline-flex items-center gap-2 truncate text-sm font-semibold">
                    <Mail className="text-muted-foreground size-3.5" strokeWidth={1.7} />
                    {inv.email}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t('team.invited_at', {
                      date: new Date(inv.invited_at).toLocaleDateString('ru-RU'),
                    })}
                    {' · '}
                    {t('team.expires_at', {
                      date: new Date(inv.expires_at).toLocaleDateString('ru-RU'),
                    })}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                  {t(`team.role.${inv.role}`)}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(t('team.confirm_cancel_invite'))) return
                      cancelInv.mutate(inv.id, {
                        onSuccess: () => toast.success(t('team.toast_invite_cancelled')),
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                      })
                    }}
                    className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                    aria-label={t('team.cancel_invite_aria')}
                  >
                    <Trash2 className="size-4" strokeWidth={1.7} />
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.invite_title')}</DialogTitle>
            <DialogDescription>{t('team.invite_subtitle')}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4 px-5 pb-2 pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              submitInvite()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-email">{t('team.invite_email')}</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                autoComplete="email"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-first-name">{t('team.invite_first_name')}</Label>
                <Input
                  id="inv-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={t('team.invite_first_name_placeholder')}
                  autoComplete="given-name"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-last-name">{t('team.invite_last_name')}</Label>
                <Input
                  id="inv-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={t('team.invite_last_name_placeholder')}
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-phone">{t('team.invite_phone')}</Label>
              <Input
                id="inv-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+48 ..."
                autoComplete="tel"
              />
              <p className="text-muted-foreground text-xs">{t('team.invite_phone_hint')}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-role">{t('team.invite_role')}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as SalonRole)}>
                <SelectTrigger id="inv-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {t(r.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{t(`team.role_hint.${role}`)}</p>
            </div>
            {role === 'staff' ? (
              <p className="text-muted-foreground rounded-md border border-sky-200 bg-sky-50 p-2 text-xs leading-relaxed">
                {t('team.invite_staff_auto_hint')}
              </p>
            ) : null}
          </form>
          <DialogFooter className="px-5">
            <Button
              variant="outline"
              type="button"
              onClick={() => setInviteOpen(false)}
              disabled={invite.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={submitInvite} disabled={invite.isPending}>
              {invite.isPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <Mail className="size-4" strokeWidth={1.8} />
              )}
              {t('team.invite_send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {openMember ? (
        <MemberCardModal
          member={openMember}
          salonId={salonId}
          canEdit={canManage || openMember.user_id === undefined}
          onClose={() => setOpenMember(null)}
        />
      ) : null}
    </div>
  )
}
