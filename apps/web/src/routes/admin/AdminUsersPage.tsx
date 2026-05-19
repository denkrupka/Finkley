import { Ban, Shield, ShieldCheck, ShieldOff, ShieldPlus, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { UserCardModal } from '@/components/admin/UserCardModal'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useAdminGrant,
  useAdminRevoke,
  useAdminUsers,
  useMemberRoleChange,
  useUserBlock,
  useUserUnblock,
  type AdminUserRow,
} from '@/hooks/useAdmin'
import { useIsAppSuperAdmin } from '@/hooks/useMediaPosts'

/**
 * Цвета чипов ролей в салонах — для визуальной различимости в таблице.
 */
const SALON_ROLE_TONE: Record<string, string> = {
  owner: 'bg-violet-100 text-violet-700',
  admin: 'bg-sky-100 text-sky-700',
  accountant: 'bg-emerald-100 text-emerald-700',
  staff: 'bg-slate-100 text-slate-700',
}

export function AdminUsersPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminUsers()
  const [openCard, setOpenCard] = useState<AdminUserRow | null>(null)
  const [editRoles, setEditRoles] = useState<AdminUserRow | null>(null)

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'load_failed'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col p-5 sm:p-8">
      <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">{t('admin.users.name')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.email')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.phone')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.app_role')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.salons')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.last_signin')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.created')}</th>
                <th className="px-4 py-3 text-right">{t('admin.users.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onOpenCard={() => setOpenCard(u)}
                  onEditRoles={() => setEditRoles(u)}
                />
              ))}
              {data.users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-muted-foreground px-4 py-8 text-center">
                    {t('admin.users.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {openCard ? <UserCardModal user={openCard} onClose={() => setOpenCard(null)} /> : null}
      {editRoles ? <EditRolesModal user={editRoles} onClose={() => setEditRoles(null)} /> : null}
    </div>
  )
}

function UserRow({
  user,
  onOpenCard,
  onEditRoles,
}: {
  user: AdminUserRow
  onOpenCard: () => void
  onEditRoles: () => void
}) {
  const { t } = useTranslation()
  const block = useUserBlock()
  const unblock = useUserUnblock()
  const grant = useAdminGrant()
  const revoke = useAdminRevoke()
  const { data: callerIsSuper } = useIsAppSuperAdmin()

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || '—'
  const isBanned = !!user.banned_until && new Date(user.banned_until).getTime() > Date.now()
  const isSuper = user.app_role === 'super_admin'
  const isAdmin = user.app_role === 'admin'

  return (
    <tr className="border-border hover:bg-muted/30 border-t">
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onOpenCard}
          className="text-foreground hover:text-primary inline-flex items-center gap-2 text-left font-semibold transition-colors"
        >
          <span>{fullName}</span>
          {isSuper ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-700">
              <ShieldCheck className="size-3" strokeWidth={2.2} />
              super
            </span>
          ) : null}
        </button>
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">{user.email ?? '—'}</td>
      <td className="text-muted-foreground px-4 py-3 text-xs">{user.phone || '—'}</td>
      <td className="px-4 py-3">
        {user.app_role ? (
          <span
            className={[
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
              user.app_role === 'super_admin'
                ? 'bg-violet-100 text-violet-700'
                : 'bg-sky-100 text-sky-700',
            ].join(' ')}
          >
            <Shield className="size-3" strokeWidth={2.2} />
            {user.app_role === 'super_admin'
              ? t('admin.users.role.super_admin')
              : t('admin.users.role.admin')}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {user.salons.length === 0 ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {user.salons.map((s) => (
              <Link
                key={s.salon_id}
                to={`/${s.salon_id}/dashboard`}
                className="bg-muted/60 hover:bg-muted text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
                title={t(`roles.${s.role}`, { defaultValue: s.role })}
              >
                <span>{s.salon_name}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${SALON_ROLE_TONE[s.role] ?? 'bg-slate-100 text-slate-700'}`}
                >
                  {t(`roles.${s.role}`, { defaultValue: s.role })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('ru-RU') : '—'}
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {new Date(user.created_at).toLocaleDateString('ru-RU')}
      </td>
      <td className="px-4 py-3">
        <div className="inline-flex items-center justify-end gap-1">
          {/* Иконка-кнопка «Роли в салонах» */}
          {user.salons.length > 0 ? (
            <IconButton
              icon={UserCheck}
              title={t('admin.users.action.edit_roles')}
              onClick={onEditRoles}
            />
          ) : null}
          {/* Иконка-кнопка «Сделать админом» / «Снять админа» (только super-admin) */}
          {callerIsSuper && !isSuper ? (
            isAdmin ? (
              <IconButton
                icon={ShieldOff}
                title={t('admin.users.action.revoke_admin')}
                tone="amber"
                disabled={revoke.isPending}
                onClick={() => {
                  if (!confirm(t('admin.users.confirm_revoke_admin'))) return
                  revoke.mutate(
                    { user_id: user.id },
                    {
                      onSuccess: () => toast.success(t('admin.users.toast.admin_revoked')),
                      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                    },
                  )
                }}
              />
            ) : (
              <IconButton
                icon={ShieldPlus}
                title={t('admin.users.action.grant_admin')}
                tone="sky"
                disabled={grant.isPending}
                onClick={() =>
                  grant.mutate(
                    { user_id: user.id, is_super: false },
                    {
                      onSuccess: () => toast.success(t('admin.users.toast.admin_granted')),
                      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                    },
                  )
                }
              />
            )
          ) : null}
          {/* Иконка-кнопка «Блокировать» / «Разблокировать» */}
          {isBanned ? (
            <IconButton
              icon={UserCheck}
              title={t('admin.users.action.unblock')}
              tone="green"
              disabled={unblock.isPending}
              onClick={() =>
                unblock.mutate(
                  { user_id: user.id },
                  {
                    onSuccess: () => toast.success(t('admin.users.toast.unblocked')),
                    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                  },
                )
              }
            />
          ) : (
            <IconButton
              icon={Ban}
              title={isSuper ? t('admin.users.cannot_block_super') : t('admin.users.action.block')}
              tone="red"
              disabled={block.isPending || isSuper}
              onClick={() => {
                if (!confirm(t('admin.users.confirm_block'))) return
                block.mutate(
                  { user_id: user.id },
                  {
                    onSuccess: () => toast.success(t('admin.users.toast.blocked')),
                    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                  },
                )
              }}
            />
          )}
        </div>
      </td>
    </tr>
  )
}

function IconButton({
  icon: Icon,
  title,
  onClick,
  disabled,
  tone = 'slate',
}: {
  icon: typeof Ban
  title: string
  onClick: () => void
  disabled?: boolean
  tone?: 'slate' | 'sky' | 'amber' | 'red' | 'green'
}) {
  const TONE: Record<string, string> = {
    slate: 'text-foreground hover:bg-muted/60',
    sky: 'text-sky-700 hover:bg-sky-50',
    amber: 'text-amber-700 hover:bg-amber-50',
    red: 'text-rose-600 hover:bg-rose-50',
    green: 'text-emerald-700 hover:bg-emerald-50',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        'inline-flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-40',
        TONE[tone],
      ].join(' ')}
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </button>
  )
}

// Тираж ролей-чекбоксов как в TeamPage. owner — спец-роль, отдельным
// бейджем (передача владения через эту модалку не делается).
const ROLE_CHECKBOX_OPTIONS: { value: 'admin' | 'accountant' | 'staff'; key: string }[] = [
  { value: 'admin', key: 'roles.admin' },
  { value: 'accountant', key: 'roles.accountant' },
  { value: 'staff', key: 'roles.staff' },
]

/** Берём highest-приоритет роль из набора. admin > accountant > staff. */
function highestRole(roles: Set<string>): 'admin' | 'accountant' | 'staff' {
  if (roles.has('admin')) return 'admin'
  if (roles.has('accountant')) return 'accountant'
  return 'staff'
}

function EditRolesModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const { t } = useTranslation()
  const change = useMemberRoleChange()
  // Для каждого salon_id храним набор выбранных ролей. Если в БД owner —
  // checkbox-блок не активен и работает только как индикатор.
  const [rolesBySalon, setRolesBySalon] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(user.salons.map((s) => [s.salon_id, new Set([s.role])])),
  )

  function toggle(salonId: string, role: string) {
    setRolesBySalon((prev) => {
      const next = new Set(prev[salonId] ?? [])
      if (next.has(role)) next.delete(role)
      else next.add(role)
      // Хотя бы одна должна быть выбрана — иначе остаётся staff по умолчанию.
      if (next.size === 0) next.add('staff')
      return { ...prev, [salonId]: next }
    })
  }

  function save() {
    const changed: { salon_id: string; role: 'admin' | 'accountant' | 'staff' }[] = []
    for (const s of user.salons) {
      if (s.role === 'owner') continue // owner редактируется отдельно
      const selected = rolesBySalon[s.salon_id]
      if (!selected) continue
      const next = highestRole(selected)
      if (next !== s.role) changed.push({ salon_id: s.salon_id, role: next })
    }
    if (changed.length === 0) {
      onClose()
      return
    }
    Promise.all(
      changed.map((c) =>
        change.mutateAsync({
          salon_id: c.salon_id,
          user_id: user.id,
          role: c.role,
        }),
      ),
    )
      .then(() => {
        toast.success(t('admin.users.toast.roles_updated', { count: changed.length }))
        onClose()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('admin.users.modal.edit_roles_title', {
              name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto px-5 py-4">
          <p className="text-muted-foreground mb-3 text-sm">
            {t('admin.users.modal.edit_roles_body')}
          </p>
          <div className="space-y-3">
            {user.salons.map((s) => {
              const isOwner = s.role === 'owner'
              const selected = rolesBySalon[s.salon_id] ?? new Set([s.role])
              return (
                <div key={s.salon_id} className="border-border rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-foreground truncate text-sm font-semibold">
                      {s.salon_name}
                    </span>
                    {isOwner ? (
                      <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                        {t('roles.owner')}
                      </span>
                    ) : null}
                  </div>
                  {isOwner ? (
                    <p className="text-muted-foreground text-[11px]">
                      {t('admin.users.modal.owner_readonly', {
                        defaultValue: 'Владелец салона. Передача владения — отдельно.',
                      })}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {ROLE_CHECKBOX_OPTIONS.map((r) => {
                        const checked = selected.has(r.value)
                        return (
                          <label
                            key={r.value}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                              checked
                                ? 'border-brand-teal bg-brand-teal-soft text-brand-teal-deep'
                                : 'border-border bg-card text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(s.salon_id, r.value)}
                              className="size-3.5"
                            />
                            {t(r.key)}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground inline-flex h-9 items-center rounded-md px-3 text-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={change.isPending}
            className="bg-brand-navy hover:bg-brand-navy/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
