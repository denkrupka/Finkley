import { Ban, CalendarClock, MoreVertical, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useAdminSalons,
  useSalonAddUser,
  useSalonBlock,
  useSalonDelete,
  useSalonExtendDemo,
  useSalonUnblock,
  type AdminSalonRow,
} from '@/hooks/useAdmin'
import { formatCurrency } from '@/lib/utils/format-currency'

type ModalKind = 'block' | 'addUser' | 'extendDemo' | 'delete' | null

export function AdminSalonsPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminSalons()
  const [modal, setModal] = useState<{ kind: ModalKind; salon: AdminSalonRow | null }>({
    kind: null,
    salon: null,
  })

  function open(kind: NonNullable<ModalKind>, salon: AdminSalonRow) {
    setModal({ kind, salon })
  }
  function close() {
    setModal({ kind: null, salon: null })
  }

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
                <th className="px-4 py-3 text-left">{t('admin.salons.name')}</th>
                <th className="px-4 py-3 text-left">{t('admin.salons.owner')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.avg_revenue')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.avg_expenses')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.avg_profit')}</th>
                <th className="px-4 py-3 text-left">{t('admin.salons.status')}</th>
                <th className="px-4 py-3 text-left">{t('admin.salons.created')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.salons.map((s) => (
                <SalonRow key={s.id} salon={s} onAction={open} />
              ))}
              {data.salons.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted-foreground px-4 py-8 text-center">
                    {t('admin.salons.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {modal.salon ? (
        <>
          <BlockModal open={modal.kind === 'block'} salon={modal.salon} onClose={close} />
          <AddUserModal open={modal.kind === 'addUser'} salon={modal.salon} onClose={close} />
          <ExtendDemoModal open={modal.kind === 'extendDemo'} salon={modal.salon} onClose={close} />
          <DeleteModal open={modal.kind === 'delete'} salon={modal.salon} onClose={close} />
        </>
      ) : null}
    </div>
  )
}

function SalonRow({
  salon,
  onAction,
}: {
  salon: AdminSalonRow
  onAction: (kind: NonNullable<ModalKind>, salon: AdminSalonRow) => void
}) {
  const { t } = useTranslation()
  const unblock = useSalonUnblock()
  const [menuOpen, setMenuOpen] = useState(false)

  function status(): { label: string; tone: 'green' | 'blue' | 'amber' | 'slate' | 'red' } {
    if (salon.blocked_at) return { label: t('admin.salons.tag.blocked'), tone: 'red' }
    const now = Date.now()
    const bonusActive = salon.bonus_until && new Date(salon.bonus_until).getTime() > now
    if (salon.plan_status === 'active' || salon.plan_status === 'past_due' || bonusActive)
      return { label: t('admin.salons.tag.subscribed'), tone: 'green' }
    if (
      salon.plan_status === 'trialing' &&
      salon.trial_ends_at &&
      new Date(salon.trial_ends_at).getTime() > now
    )
      return { label: t('admin.salons.tag.on_trial'), tone: 'blue' }
    if (salon.trial_ends_at && new Date(salon.trial_ends_at).getTime() <= now)
      return { label: t('admin.salons.tag.trial_expired'), tone: 'amber' }
    return { label: t('admin.salons.tag.inactive'), tone: 'slate' }
  }

  const TONE: Record<string, string> = {
    green: 'bg-emerald-100 text-emerald-700',
    blue: 'bg-sky-100 text-sky-700',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-100 text-slate-600',
    red: 'bg-rose-100 text-rose-700',
  }
  const st = status()

  return (
    <tr className="border-border border-t">
      <td className="px-4 py-3 font-semibold">
        <a href={`/${salon.id}/dashboard`} className="hover:underline">
          {salon.name}
        </a>
      </td>
      <td className="text-muted-foreground px-4 py-3">{salon.owner_email ?? '—'}</td>
      <td className="num px-4 py-3 text-right">
        {formatCurrency(salon.avg_revenue_cents, salon.currency)}
      </td>
      <td className="num px-4 py-3 text-right">
        {formatCurrency(salon.avg_expenses_cents, salon.currency)}
      </td>
      <td
        className={[
          'num px-4 py-3 text-right',
          salon.avg_profit_cents < 0 ? 'text-rose-600' : 'text-emerald-600',
        ].join(' ')}
      >
        {formatCurrency(salon.avg_profit_cents, salon.currency)}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TONE[st.tone]}`}
        >
          {st.label}
        </span>
        {salon.bonus_until ? (
          <p className="text-muted-foreground mt-1 text-[10px]">
            {t('admin.salons.bonus_until', {
              date: new Date(salon.bonus_until).toLocaleDateString('ru-RU'),
            })}
          </p>
        ) : null}
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {new Date(salon.created_at).toLocaleDateString('ru-RU')}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="relative inline-block">
          <button
            type="button"
            className="hover:bg-muted/60 inline-flex size-8 items-center justify-center rounded-md"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('admin.salons.actions')}
          >
            <MoreVertical className="size-4" strokeWidth={1.8} />
          </button>
          {menuOpen ? (
            <div
              className="border-border bg-card shadow-finmd absolute right-0 top-9 z-20 w-56 rounded-md border p-1 text-left"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <MenuItem
                icon={UserPlus}
                label={t('admin.salons.action_add_user')}
                onClick={() => {
                  setMenuOpen(false)
                  onAction('addUser', salon)
                }}
              />
              <MenuItem
                icon={CalendarClock}
                label={t('admin.salons.action_extend_demo')}
                onClick={() => {
                  setMenuOpen(false)
                  onAction('extendDemo', salon)
                }}
              />
              {salon.blocked_at ? (
                <MenuItem
                  icon={Ban}
                  label={t('admin.salons.action_unblock')}
                  onClick={() => {
                    setMenuOpen(false)
                    unblock.mutate(
                      { salon_id: salon.id },
                      {
                        onSuccess: () => toast.success(t('admin.salons.toast.unblocked')),
                        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                      },
                    )
                  }}
                />
              ) : (
                <MenuItem
                  icon={Ban}
                  label={t('admin.salons.action_block')}
                  onClick={() => {
                    setMenuOpen(false)
                    onAction('block', salon)
                  }}
                />
              )}
              <MenuItem
                icon={Trash2}
                label={t('admin.salons.action_delete')}
                tone="danger"
                onClick={() => {
                  setMenuOpen(false)
                  onAction('delete', salon)
                }}
              />
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: typeof Ban
  label: string
  onClick: () => void
  tone?: 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
        tone === 'danger' ? 'text-rose-600 hover:bg-rose-50' : 'text-foreground hover:bg-muted/60',
      ].join(' ')}
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
      {label}
    </button>
  )
}

function BlockModal({
  open,
  salon,
  onClose,
}: {
  open: boolean
  salon: AdminSalonRow
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const block = useSalonBlock()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.salons.modal.block_title', { name: salon.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('admin.salons.modal.block_body')}</p>
        <Label className="mt-3 text-xs">{t('admin.salons.modal.reason')}</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-10" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={block.isPending}
            onClick={() =>
              block.mutate(
                { salon_id: salon.id, reason: reason || undefined },
                {
                  onSuccess: () => {
                    toast.success(t('admin.salons.toast.blocked'))
                    onClose()
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                },
              )
            }
          >
            {t('admin.salons.modal.block_confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddUserModal({
  open,
  salon,
  onClose,
}: {
  open: boolean
  salon: AdminSalonRow
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'owner' | 'admin' | 'staff' | 'accountant'>('staff')
  const add = useSalonAddUser()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.salons.modal.add_user_title', { name: salon.name })}</DialogTitle>
        </DialogHeader>
        <Label className="text-xs">{t('admin.salons.modal.email')}</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          className="h-10"
        />
        <Label className="mt-3 text-xs">{t('admin.salons.modal.role')}</Label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'owner' | 'admin' | 'staff' | 'accountant')}
          className="border-border bg-card h-10 w-full rounded-md border px-3 text-sm"
        >
          <option value="staff">{t('roles.staff')}</option>
          <option value="admin">{t('roles.admin')}</option>
          <option value="accountant">{t('roles.accountant')}</option>
          <option value="owner">{t('roles.owner')}</option>
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={add.isPending || !email.includes('@')}
            onClick={() =>
              add.mutate(
                { salon_id: salon.id, email, role },
                {
                  onSuccess: (r) => {
                    toast.success(
                      r.mode === 'invited'
                        ? t('admin.salons.toast.user_invited')
                        : t('admin.salons.toast.user_attached'),
                    )
                    onClose()
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                },
              )
            }
          >
            {t('admin.salons.modal.add_user_confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ExtendDemoModal({
  open,
  salon,
  onClose,
}: {
  open: boolean
  salon: AdminSalonRow
  onClose: () => void
}) {
  const { t } = useTranslation()
  const defaultDate = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)
  const [date, setDate] = useState(defaultDate)
  const [reason, setReason] = useState('')
  const extend = useSalonExtendDemo()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.salons.modal.extend_title', { name: salon.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('admin.salons.modal.extend_body')}</p>
        <Label className="mt-3 text-xs">{t('admin.salons.modal.until_date')}</Label>
        <Input
          type="date"
          value={date}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="h-10"
        />
        <Label className="mt-3 text-xs">{t('admin.salons.modal.reason')}</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-10" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={extend.isPending || !date}
            onClick={() => {
              const iso = new Date(`${date}T23:59:59Z`).toISOString()
              extend.mutate(
                { salon_id: salon.id, until_iso: iso, reason: reason || undefined },
                {
                  onSuccess: () => {
                    toast.success(t('admin.salons.toast.demo_extended'))
                    onClose()
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                },
              )
            }}
          >
            {t('admin.salons.modal.extend_confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeleteModal({
  open,
  salon,
  onClose,
}: {
  open: boolean
  salon: AdminSalonRow
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState('')
  const del = useSalonDelete()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.salons.modal.delete_title', { name: salon.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-rose-600">{t('admin.salons.modal.delete_warning')}</p>
        <Label className="mt-3 text-xs">
          {t('admin.salons.modal.delete_confirm_label', { name: salon.name })}
        </Label>
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={salon.name}
          className="h-10"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={del.isPending || confirm !== salon.name}
            onClick={() =>
              del.mutate(
                { salon_id: salon.id },
                {
                  onSuccess: (r) => {
                    toast.success(t('admin.salons.toast.deleted', { users: r.deleted_users }))
                    onClose()
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                },
              )
            }
          >
            {t('admin.salons.modal.delete_confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
