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
import { useStaff, useUnlinkedStaff } from '@/hooks/useStaff'
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

import { PermissionsBlock, type PermissionsMap } from './PermissionsBlock'

const ROLE_OPTIONS: { value: SalonRole; key: string }[] = [
  { value: 'admin', key: 'team.role.admin' },
  { value: 'accountant', key: 'team.role.accountant' },
  { value: 'staff', key: 'team.role.staff' },
  { value: 'external', key: 'team.role.external' },
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
  // Multi-role: набор checkbox'ов. Финальный role в БД — топ-приоритет
  // owner > admin > accountant > staff. Если «Мастер» отмечен вместе с
  // admin/accountant — это «Админ-Мастер»: salon_members.role = admin,
  // плюс staff_id заранее задан или auto_create_staff=true.
  const [selectedRoles, setSelectedRoles] = useState<Set<SalonRole>>(new Set(['staff']))
  const [staffLinkChoice, setStaffLinkChoice] = useState<string>('new')
  // T30 — матрица прав. При смене роли PermissionsBlock сам пересчитает preset
  // через onChange callback (см. useEffect внутри). null = «использовать preset
  // роли на сервере» (отправляем undefined в invite).
  const [permissions, setPermissions] = useState<PermissionsMap | null>(null)

  const { data: unlinkedStaff = [] } = useUnlinkedStaff(salonId)
  const isMasterChecked = selectedRoles.has('staff')

  function toggleRole(r: SalonRole) {
    setSelectedRoles((prev) => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r)
      else next.add(r)
      // Хотя бы одна роль должна быть выбрана.
      if (next.size === 0) next.add('staff')
      return next
    })
  }

  function highestRole(): SalonRole {
    if (selectedRoles.has('admin')) return 'admin'
    if (selectedRoles.has('accountant')) return 'accountant'
    if (selectedRoles.has('staff')) return 'staff'
    if (selectedRoles.has('external')) return 'external'
    return 'staff'
  }

  const canManage = myRole === 'owner' || myRole === 'admin'

  function submitInvite() {
    if (!email.trim()) {
      toast.error(t('team.errors.email_required'))
      return
    }
    const role = highestRole()
    // Staff-link срабатывает если в multi-role выбран «Мастер».
    const wantsMasterLink = isMasterChecked
    const linkExistingStaffId =
      wantsMasterLink && staffLinkChoice !== 'new' ? staffLinkChoice : null
    // auto_create_staff: если выбран «Мастер» И не выбран существующий staff_id.
    const autoCreateStaff =
      wantsMasterLink && !linkExistingStaffId && role !== 'staff' ? true : false
    // Для role='staff' без существующего staff_id — RPC уже создаст staff
    // (legacy behavior). auto_create_staff не нужен дополнительно.

    // Преобразуем PermissionsMap → отправляемый формат: оставляем только
    // явные 'view'/'edit', 'none' пропускаем (= отсутствие ключа = нет доступа).
    const permsToSend = permissions
      ? (Object.fromEntries(
          Object.entries(permissions).filter(([, v]) => v === 'view' || v === 'edit'),
        ) as Record<string, 'view' | 'edit'>)
      : undefined

    invite.mutate(
      {
        email: email.trim(),
        role,
        staffId: linkExistingStaffId,
        autoCreateStaff,
        // T26 — first_name/last_name/phone/avatar заполняет приглашённый
        // самостоятельно в InviteSignupForm после accept-invite.
        permissions: permsToSend,
      },
      {
        onSuccess: () => {
          toast.success(t('team.toast_invited'))
          setInviteOpen(false)
          setEmail('')
          setSelectedRoles(new Set(['staff']))
          setStaffLinkChoice('new')
          setPermissions(null)
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

      {/* Invite dialog — 2 колонки: левая Email/Роль/Мастер, правая Доступы */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="flex max-h-[92vh] w-[min(1200px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[1200px]">
          <div className="border-border border-b px-5 py-4">
            <DialogHeader>
              <DialogTitle>{t('team.invite_title')}</DialogTitle>
              <DialogDescription>{t('team.invite_subtitle')}</DialogDescription>
            </DialogHeader>
          </div>
          <form
            className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
            onSubmit={(e) => {
              e.preventDefault()
              submitInvite()
            }}
          >
            {/* Левая колонка: Email + Роль + Карточка мастера */}
            <div className="md:border-border flex flex-col gap-4 overflow-y-auto px-5 py-4 md:border-r">
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

              <div className="flex flex-col gap-1.5">
                <Label>{t('team.invite_role')}</Label>
                <p className="text-muted-foreground -mt-1 text-xs">
                  {t('team.invite_role_multi_hint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {ROLE_OPTIONS.map((r) => {
                    const active = selectedRoles.has(r.value)
                    return (
                      <label
                        key={r.value}
                        className={`border-border flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm transition-colors ${
                          active ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleRole(r.value)}
                          className="mt-0.5 size-4"
                        />
                        <div className="flex-1">
                          <p className="text-foreground font-semibold">{t(r.key)}</p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {t(`team.role_hint.${r.value}`)}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {isMasterChecked && unlinkedStaff.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inv-staff-link">{t('team.invite_staff_link')}</Label>
                  <Select value={staffLinkChoice} onValueChange={setStaffLinkChoice}>
                    <SelectTrigger id="inv-staff-link">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">{t('team.invite_staff_new')}</SelectItem>
                      {unlinkedStaff.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.full_name}
                          {s.external_source ? (
                            <span className="text-muted-foreground ml-1 text-xs">
                              · {s.external_source}
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {staffLinkChoice === 'new'
                      ? t('team.invite_staff_new_hint')
                      : t('team.invite_staff_existing_hint')}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Правая колонка: Доступы (дерево разрешений) */}
            <div className="bg-muted/10 flex flex-col overflow-y-auto px-5 py-4">
              <PermissionsBlock
                role={highestRole()}
                value={permissions ?? undefined}
                onChange={setPermissions}
              />
            </div>
          </form>
          <DialogFooter className="border-border shrink-0 border-t bg-white px-5 py-3">
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
