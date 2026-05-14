import { Ban, ShieldCheck, ShieldOff, ShieldPlus, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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

export function AdminUsersPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminUsers()
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
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">{t('admin.users.name')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.email')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.app_role')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.salons')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.last_signin')}</th>
                <th className="px-4 py-3 text-left">{t('admin.users.created')}</th>
                <th className="px-4 py-3 text-right">{t('admin.users.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <UserRow key={u.id} user={u} onEditRoles={() => setEditRoles(u)} />
              ))}
              {data.users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-4 py-8 text-center">
                    {t('admin.users.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {editRoles ? <EditRolesModal user={editRoles} onClose={() => setEditRoles(null)} /> : null}
    </div>
  )
}

function UserRow({ user, onEditRoles }: { user: AdminUserRow; onEditRoles: () => void }) {
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
    <tr className="border-border border-t">
      <td className="px-4 py-3 font-semibold">
        {fullName}
        {isSuper ? (
          <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-700">
            <ShieldCheck className="size-3" strokeWidth={2.2} />
            super
          </span>
        ) : null}
      </td>
      <td className="text-muted-foreground px-4 py-3">{user.email ?? '—'}</td>
      <td className="px-4 py-3">
        {user.app_role ? (
          <span
            className={[
              'inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
              user.app_role === 'super_admin'
                ? 'bg-violet-100 text-violet-700'
                : 'bg-sky-100 text-sky-700',
            ].join(' ')}
          >
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
                className="bg-muted/60 hover:bg-muted text-foreground rounded-md px-2 py-0.5 text-[11px] font-semibold"
                title={t(`roles.${s.role}`)}
              >
                {s.salon_name}
                <span className="text-muted-foreground ml-1 text-[10px]">
                  · {t(`roles.${s.role}`)}
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
      <td className="px-4 py-3 text-right">
        <div className="inline-flex flex-wrap justify-end gap-1">
          {user.salons.length > 0 ? (
            <button
              type="button"
              onClick={onEditRoles}
              className="hover:bg-muted/60 inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold"
              title={t('admin.users.action.edit_roles')}
            >
              <UserCheck className="size-3.5" strokeWidth={1.8} />
              {t('admin.users.action.edit_roles')}
            </button>
          ) : null}
          {/* Admin RBAC — только super-admin может назначать/снимать админов */}
          {callerIsSuper && !isSuper ? (
            isAdmin ? (
              <Button
                variant="outline"
                size="sm"
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
              >
                <ShieldOff className="size-3.5" strokeWidth={1.8} />
                {t('admin.users.action.revoke_admin')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
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
              >
                <ShieldPlus className="size-3.5" strokeWidth={1.8} />
                {t('admin.users.action.grant_admin')}
              </Button>
            )
          ) : null}
          {isBanned ? (
            <Button
              variant="outline"
              size="sm"
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
            >
              <UserCheck className="size-3.5" strokeWidth={1.8} />
              {t('admin.users.action.unblock')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={block.isPending || isSuper}
              title={isSuper ? t('admin.users.cannot_block_super') : undefined}
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
            >
              <Ban className="size-3.5" strokeWidth={1.8} />
              {t('admin.users.action.block')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function EditRolesModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const { t } = useTranslation()
  const change = useMemberRoleChange()
  const [roles, setRoles] = useState<Record<string, string>>(() =>
    Object.fromEntries(user.salons.map((s) => [s.salon_id, s.role])),
  )

  function save() {
    const changed = user.salons.filter((s) => roles[s.salon_id] !== s.role)
    if (changed.length === 0) {
      onClose()
      return
    }
    Promise.all(
      changed.map((s) =>
        change.mutateAsync({
          salon_id: s.salon_id,
          user_id: user.id,
          role: roles[s.salon_id] ?? s.role,
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
        <p className="text-muted-foreground text-sm">{t('admin.users.modal.edit_roles_body')}</p>
        <div className="mt-3 space-y-2">
          {user.salons.map((s) => (
            <div
              key={s.salon_id}
              className="border-border flex items-center justify-between gap-3 rounded-md border p-2"
            >
              <span className="text-foreground text-sm font-semibold">{s.salon_name}</span>
              <select
                value={roles[s.salon_id] ?? s.role}
                onChange={(e) => setRoles((r) => ({ ...r, [s.salon_id]: e.target.value }))}
                className="border-border bg-card h-9 rounded-md border px-2 text-sm"
              >
                <option value="owner">{t('roles.owner')}</option>
                <option value="admin">{t('roles.admin')}</option>
                <option value="accountant">{t('roles.accountant')}</option>
                <option value="staff">{t('roles.staff')}</option>
              </select>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={change.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
