import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, Ban, CalendarClock, MoreVertical, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { UserCardModal } from '@/components/admin/UserCardModal'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useAdminSalons,
  useAdminUsers,
  useSalonAddUser,
  useSalonBlock,
  useSalonDelete,
  useSalonExtendDemo,
  useSalonUnblock,
  type AdminSalonRow,
  type AdminUserRow,
} from '@/hooks/useAdmin'
import { formatCurrency } from '@/lib/utils/format-currency'
import { SALON_TYPES } from '@/routes/onboarding/onboarding-defaults'

type ModalKind = 'block' | 'addUser' | 'extendDemo' | 'delete' | null

const STATUS_TONE: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  blue: 'bg-sky-100 text-sky-700',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-100 text-slate-600',
  red: 'bg-rose-100 text-rose-700',
}

export function AdminSalonsPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminSalons()
  const { data: usersData } = useAdminUsers()
  const [modal, setModal] = useState<{ kind: ModalKind; salon: AdminSalonRow | null }>({
    kind: null,
    salon: null,
  })
  const [openUserCard, setOpenUserCard] = useState<AdminUserRow | null>(null)

  function open(kind: NonNullable<ModalKind>, salon: AdminSalonRow) {
    setModal({ kind, salon })
  }
  function close() {
    setModal({ kind: null, salon: null })
  }

  function openOwnerCard(ownerId: string | null) {
    if (!ownerId || !usersData) return
    const u = usersData.users.find((x) => x.id === ownerId)
    if (u) setOpenUserCard(u)
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
                <th className="px-4 py-3 text-left">{t('admin.salons.type')}</th>
                <th className="px-4 py-3 text-left">{t('admin.salons.owner')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.period_months')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.avg_profit')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.portal_revenue')}</th>
                <th className="px-4 py-3 text-left">{t('admin.salons.status')}</th>
                <th className="px-4 py-3 text-left">{t('admin.salons.valid_until')}</th>
                <th className="px-4 py-3 text-left">{t('admin.salons.created')}</th>
                <th className="px-4 py-3 text-right">{t('admin.salons.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.salons.map((s) => (
                <SalonRow
                  key={s.id}
                  salon={s}
                  onAction={open}
                  onOwnerClick={() => openOwnerCard(s.owner_id)}
                />
              ))}
              {data.salons.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-muted-foreground px-4 py-8 text-center">
                    {t('admin.salons.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {openUserCard ? (
        <UserCardModal user={openUserCard} onClose={() => setOpenUserCard(null)} />
      ) : null}

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
  onOwnerClick,
}: {
  salon: AdminSalonRow
  onAction: (kind: NonNullable<ModalKind>, salon: AdminSalonRow) => void
  onOwnerClick: () => void
}) {
  const { t } = useTranslation()
  const unblock = useSalonUnblock()

  // effective_status считается на сервере (handleSalons): учитывает explicit
  // Stripe-saubscription, bonus_until и implicit trial (created_at + 14 дн.)
  const STATUS_MAP: Record<
    AdminSalonRow['effective_status'],
    { label: string; tone: keyof typeof STATUS_TONE }
  > = {
    blocked: { label: t('admin.salons.tag.blocked'), tone: 'red' },
    subscribed: { label: t('admin.salons.tag.subscribed'), tone: 'green' },
    on_trial: { label: t('admin.salons.tag.on_trial'), tone: 'blue' },
    trial_expired: { label: t('admin.salons.tag.trial_expired'), tone: 'amber' },
    inactive: { label: t('admin.salons.tag.inactive'), tone: 'slate' },
  }
  const st = STATUS_MAP[salon.effective_status]

  const ownerName =
    [salon.owner_first_name, salon.owner_last_name].filter(Boolean).join(' ') ||
    salon.owner_email ||
    '—'

  // Лейбл типа салона из onboarding-defaults — отображаем русское имя по id.
  // Если в БД сохранён кастомный type (пользователь ввёл свой) или null —
  // показываем как есть либо «—».
  const typeLabel = salon.salon_type
    ? (SALON_TYPES.find((tp) => tp.id === salon.salon_type)?.name ?? salon.salon_type)
    : '—'

  return (
    <tr className="border-border hover:bg-muted/30 border-t">
      <td className="px-4 py-3 font-semibold">
        <a href={`/${salon.id}/dashboard`} className="hover:underline">
          {salon.name}
        </a>
      </td>
      <td className="text-muted-foreground px-4 py-3 text-sm">{typeLabel}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onOwnerClick}
          className="text-foreground hover:text-primary text-left text-sm font-medium transition-colors"
        >
          {ownerName}
        </button>
      </td>
      <td className="num text-muted-foreground px-4 py-3 text-right text-xs">
        {t('admin.salons.months', { count: salon.period_months })}
      </td>
      <td
        className={[
          'num px-4 py-3 text-right',
          salon.avg_profit_cents < 0 ? 'text-rose-600' : 'text-emerald-600',
        ].join(' ')}
      >
        {formatCurrency(salon.avg_profit_cents, salon.currency)}
      </td>
      <td className="num text-brand-navy px-4 py-3 text-right font-semibold">
        {formatCurrency(salon.portal_revenue_cents, 'EUR')}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[st.tone]}`}
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
        {salon.valid_until ? new Date(salon.valid_until).toLocaleDateString('ru-RU') : '—'}
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {new Date(salon.created_at).toLocaleDateString('ru-RU')}
      </td>
      <td className="px-4 py-3 text-right">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="hover:bg-muted/60 inline-flex size-8 items-center justify-center rounded-md"
              aria-label={t('admin.salons.actions')}
            >
              <MoreVertical className="size-4" strokeWidth={1.8} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="border-border bg-card shadow-finmd z-50 w-56 rounded-md border p-1 text-sm"
            >
              <DropdownItem
                icon={UserPlus}
                onSelect={() => onAction('addUser', salon)}
                label={t('admin.salons.action_add_user')}
              />
              <DropdownItem
                icon={CalendarClock}
                onSelect={() => onAction('extendDemo', salon)}
                label={t('admin.salons.action_extend_demo')}
              />
              {salon.blocked_at ? (
                <DropdownItem
                  icon={Ban}
                  onSelect={() =>
                    unblock.mutate(
                      { salon_id: salon.id },
                      {
                        onSuccess: () => toast.success(t('admin.salons.toast.unblocked')),
                        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                      },
                    )
                  }
                  label={t('admin.salons.action_unblock')}
                />
              ) : (
                <DropdownItem
                  icon={Ban}
                  onSelect={() => onAction('block', salon)}
                  label={t('admin.salons.action_block')}
                />
              )}
              <DropdownMenu.Separator className="bg-border mx-1 my-1 h-px" />
              <DropdownItem
                icon={Trash2}
                onSelect={() => onAction('delete', salon)}
                label={t('admin.salons.action_delete')}
                tone="danger"
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </td>
    </tr>
  )
}

function DropdownItem({
  icon: Icon,
  onSelect,
  label,
  tone,
}: {
  icon: typeof Ban
  onSelect: () => void
  label: string
  tone?: 'danger'
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={[
        'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
        tone === 'danger'
          ? 'text-rose-600 data-[highlighted]:bg-rose-50'
          : 'text-foreground data-[highlighted]:bg-muted/60',
      ].join(' ')}
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
      {label}
    </DropdownMenu.Item>
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
        <div className="overflow-y-auto px-5 py-4">
          <p className="text-muted-foreground text-sm">{t('admin.salons.modal.block_body')}</p>
          <Label className="mt-3 block text-xs">{t('admin.salons.modal.reason')}</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 h-10"
            autoFocus
          />
        </div>
        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
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
        <div className="overflow-y-auto px-5 py-4">
          <Label htmlFor="add-user-email" className="block text-xs">
            {t('admin.salons.modal.email')}
          </Label>
          <Input
            id="add-user-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="mt-1 h-10"
            autoFocus
          />
          <Label htmlFor="add-user-role" className="mt-4 block text-xs">
            {t('admin.salons.modal.role')}
          </Label>
          <select
            id="add-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'owner' | 'admin' | 'staff' | 'accountant')}
            className="border-border bg-card mt-1 h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="staff">{t('roles.staff')}</option>
            <option value="accountant">{t('roles.accountant')}</option>
            <option value="admin">{t('roles.admin')}</option>
            <option value="owner">{t('roles.owner')}</option>
          </select>
          <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
            {t('admin.salons.modal.add_user_hint')}
          </p>
        </div>
        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
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
        <div className="overflow-y-auto px-5 py-4">
          <p className="text-muted-foreground text-sm">{t('admin.salons.modal.extend_body')}</p>
          <Label className="mt-3 block text-xs">{t('admin.salons.modal.until_date')}</Label>
          <Input
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 h-10"
            autoFocus
          />
          <Label className="mt-3 block text-xs">{t('admin.salons.modal.reason')}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-10" />
        </div>
        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
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

/**
 * Удаление салона — three-step flow:
 *   Step 1: предупреждение + ввести имя салона для подтверждения
 *   Step 2: явно подтвердить «Я понимаю что это необратимо»
 *   Step 3: финальная кнопка «Удалить» с 3-секундной задержкой (anti-misclick)
 */
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
  const [step, setStep] = useState(1)
  const [confirmName, setConfirmName] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const del = useSalonDelete()

  // Reset on open
  function reset() {
    setStep(1)
    setConfirmName('')
    setUnderstood(false)
    setCooldown(0)
  }

  function goStep2() {
    if (confirmName !== salon.name) return
    setStep(2)
  }
  function goStep3() {
    if (!understood) return
    setStep(3)
    setCooldown(3)
    const id = window.setInterval(() => {
      setCooldown((v) => {
        if (v <= 1) {
          window.clearInterval(id)
          return 0
        }
        return v - 1
      })
    }, 1000)
  }

  function performDelete() {
    del.mutate(
      { salon_id: salon.id },
      {
        onSuccess: (r) => {
          toast.success(t('admin.salons.toast.deleted', { users: r.deleted_users }))
          reset()
          onClose()
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function handleClose() {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <AlertTriangle className="size-5" strokeWidth={2} />
            {step === 1
              ? t('admin.salons.modal.delete_title', { name: salon.name })
              : step === 2
                ? t('admin.salons.modal.delete_step2_title')
                : t('admin.salons.modal.delete_step3_title')}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-4">
          {step === 1 ? (
            <>
              <p className="text-sm text-rose-600">{t('admin.salons.modal.delete_warning')}</p>
              <Label className="mt-3 block text-xs">
                {t('admin.salons.modal.delete_confirm_label', { name: salon.name })}
              </Label>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={salon.name}
                className="mt-1 h-10"
                autoFocus
              />
            </>
          ) : step === 2 ? (
            <>
              <p className="text-foreground text-sm">{t('admin.salons.modal.delete_step2_body')}</p>
              <ul className="text-muted-foreground mt-3 space-y-1 text-xs">
                <li>• {t('admin.salons.modal.delete_step2_li_data')}</li>
                <li>• {t('admin.salons.modal.delete_step2_li_users')}</li>
                <li>• {t('admin.salons.modal.delete_step2_li_irreversible')}</li>
              </ul>
              <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                  className="mt-0.5 size-4 accent-rose-600"
                />
                <span className="text-foreground">
                  {t('admin.salons.modal.delete_step2_checkbox')}
                </span>
              </label>
            </>
          ) : (
            <>
              <p className="text-foreground text-sm">
                {t('admin.salons.modal.delete_step3_body', { name: salon.name })}
              </p>
              <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-center text-xs text-rose-800">
                {cooldown > 0
                  ? t('admin.salons.modal.delete_step3_cooldown', { sec: cooldown })
                  : t('admin.salons.modal.delete_step3_ready')}
              </div>
            </>
          )}
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={del.isPending}>
            {t('common.cancel')}
          </Button>
          {step === 1 ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmName !== salon.name}
              onClick={goStep2}
            >
              {t('common.next')}
            </Button>
          ) : step === 2 ? (
            <Button variant="destructive" size="sm" disabled={!understood} onClick={goStep3}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={cooldown > 0 || del.isPending}
              onClick={performDelete}
            >
              {cooldown > 0
                ? `${t('admin.salons.modal.delete_confirm')} (${cooldown})`
                : t('admin.salons.modal.delete_confirm')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
