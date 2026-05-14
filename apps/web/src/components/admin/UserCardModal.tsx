import {
  Ban,
  Building2,
  Calendar,
  FlaskConical,
  Mail,
  Phone,
  Shield,
  ShieldCheck,
  ShieldOff,
  ShieldPlus,
  User as UserIcon,
  UserCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useAdminGrant,
  useAdminRevoke,
  useSetTesterFlag,
  useUserBlock,
  useUserUnblock,
  type AdminUserRow,
} from '@/hooks/useAdmin'
import { useIsAppSuperAdmin } from '@/hooks/useMediaPosts'

/**
 * Модалка с подробной карточкой пользователя. Используется и в /admin/users
 * (по клику на имя), и в /admin/salons (по клику на владельца).
 *
 * Содержит контакты, роль в админке, тестировщик, список салонов с ролями,
 * последний вход, регистрация + кнопки управления (блок/админ/тестер).
 */
export function UserCardModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const { t } = useTranslation()
  const block = useUserBlock()
  const unblock = useUserUnblock()
  const grant = useAdminGrant()
  const revoke = useAdminRevoke()
  const setTester = useSetTesterFlag()
  const { data: callerIsSuper } = useIsAppSuperAdmin()

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || '—'
  const isBanned = !!user.banned_until && new Date(user.banned_until).getTime() > Date.now()
  const isSuper = user.app_role === 'super_admin'
  const isAdmin = user.app_role === 'admin'

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:!w-[560px] sm:!max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="bg-brand-navy/10 text-brand-navy grid size-9 place-items-center rounded-full">
              <UserIcon className="size-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate">{fullName}</span>
                {isSuper ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-700">
                    <ShieldCheck className="size-3" strokeWidth={2.2} />
                    super
                  </span>
                ) : isAdmin ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700">
                    <Shield className="size-3" strokeWidth={2.2} />
                    admin
                  </span>
                ) : null}
                {user.is_tester ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                    <FlaskConical className="size-3" strokeWidth={2.2} />
                    tester
                  </span>
                ) : null}
                {isBanned ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                    <Ban className="size-3" strokeWidth={2.2} />
                    blocked
                  </span>
                ) : null}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* Contacts */}
          <section>
            <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {t('admin.user_card.contacts')}
            </h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="text-muted-foreground size-3.5" strokeWidth={1.8} />
                <span className="truncate">{user.email ?? '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="text-muted-foreground size-3.5" strokeWidth={1.8} />
                <span>{user.phone || '—'}</span>
              </div>
            </div>
          </section>

          {/* Activity */}
          <section>
            <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {t('admin.user_card.activity')}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">{t('admin.user_card.last_signin')}</p>
                <p className="text-foreground mt-0.5 font-semibold">
                  {user.last_sign_in_at
                    ? new Date(user.last_sign_in_at).toLocaleString('ru-RU')
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('admin.user_card.registered')}</p>
                <p className="text-foreground mt-0.5 inline-flex items-center gap-1 font-semibold">
                  <Calendar className="size-3" strokeWidth={2} />
                  {new Date(user.created_at).toLocaleDateString('ru-RU')}
                </p>
              </div>
            </div>
          </section>

          {/* Salons */}
          <section>
            <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {t('admin.user_card.salons')}
            </h3>
            {user.salons.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t('admin.user_card.no_salons')}</p>
            ) : (
              <ul className="space-y-1.5">
                {user.salons.map((s) => (
                  <li key={s.salon_id}>
                    <Link
                      to={`/${s.salon_id}/dashboard`}
                      className="border-border hover:bg-muted/40 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2 truncate">
                        <Building2
                          className="text-muted-foreground size-3.5 shrink-0"
                          strokeWidth={1.8}
                        />
                        <span className="truncate font-semibold">{s.salon_name}</span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ROLE_TONE[s.role] ?? 'bg-slate-100 text-slate-700'}`}
                      >
                        {t(`roles.${s.role}`, { defaultValue: s.role })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Footer actions */}
        <div className="border-border flex flex-wrap items-center gap-2 border-t px-5 py-3">
          {/* Тестировщик toggle */}
          <Button
            variant="outline"
            size="sm"
            disabled={setTester.isPending}
            onClick={() =>
              setTester.mutate(
                { user_id: user.id, is_tester: !user.is_tester },
                {
                  onSuccess: () =>
                    toast.success(
                      user.is_tester
                        ? t('admin.users.toast.tester_off')
                        : t('admin.users.toast.tester_on'),
                    ),
                  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                },
              )
            }
          >
            <FlaskConical className="size-3.5" strokeWidth={1.8} />
            {user.is_tester ? t('admin.user_card.unset_tester') : t('admin.user_card.set_tester')}
          </Button>

          {/* Admin grant/revoke — только super-admin может назначать */}
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

          {/* Spacer */}
          <div className="flex-1" />

          {/* Block / Unblock */}
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
