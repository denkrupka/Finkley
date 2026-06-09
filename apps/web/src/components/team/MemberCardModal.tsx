import { Loader2, Save, Upload, User as UserIcon, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ImageCropper } from '@/components/ui/ImageCropper'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import {
  useUpdateMemberProfile,
  useUpdateMemberRole,
  type SalonRole,
  type TeamMember,
} from '@/hooks/useTeam'
import { supabase } from '@/lib/supabase/client'

const ROLE_OPTIONS: { value: SalonRole; key: string }[] = [
  { value: 'owner', key: 'team.role.owner' },
  { value: 'admin', key: 'team.role.admin' },
  { value: 'accountant', key: 'team.role.accountant' },
  { value: 'staff', key: 'team.role.staff' },
]

/**
 * Карточка участника команды — клик по строке в /salon/settings/team.
 *
 * Owner-feedback 09.06: открываем сразу форму редактирования (раньше был
 * промежуточный read-only экран с кнопкой «Изменить»). Поля: аватар, имя,
 * фамилия, телефон, роль. Email — read-only (смена требует auth-flow,
 * доступна только super-admin порталу).
 *
 * Если у текущего юзера нет прав на управление (canEdit=false) — поля
 * показываются disabled, кнопка «Сохранить» скрыта.
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
  const { user } = useAuth()
  const update = useUpdateMemberProfile(salonId)
  const updateRole = useUpdateMemberRole(salonId)

  const [firstName, ...rest] = (member.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  const lastName = rest.join(' ')
  const [draft, setDraft] = useState({
    first_name: firstName ?? '',
    last_name: lastName ?? '',
    phone: member.phone ?? '',
    role: member.role,
    avatar_url: member.avatar_url,
  })

  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const displayName =
    [draft.first_name, draft.last_name].filter(Boolean).join(' ').trim() ||
    member.full_name?.trim() ||
    member.invited_email ||
    member.user_id.slice(0, 8)

  const initials =
    displayName
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || undefined

  function pickAvatarFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('team.member_card.avatar_too_large', { defaultValue: 'Макс. 5 МБ' }))
      return
    }
    setCropFile(file)
  }

  async function handleCroppedAvatar(blob: Blob) {
    if (!user) return
    setUploading(true)
    try {
      // Грузим в собственную папку текущего юзера (own-folder RLS на bucket
      // avatars). Публичный URL затем сохраняется в profile целевого члена
      // через edge-функцию team-update-member (service role).
      const path = `${user.id}/member-${member.user_id}-${Date.now()}.webp`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/webp' })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      setDraft((d) => ({ ...d, avatar_url: pub.publicUrl }))
      setCropFile(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  function save() {
    update.mutate(
      {
        target_user_id: member.user_id,
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        phone: draft.phone.trim(),
        avatar_url: draft.avatar_url,
      },
      {
        onSuccess: () => {
          // Если роль изменилась — дёргаем updateRole отдельно (другой RPC).
          if (draft.role !== member.role) {
            updateRole.mutate(
              { memberId: member.id, role: draft.role },
              {
                onSuccess: () => {
                  toast.success(t('team.member_card.toast_saved'))
                  onClose()
                },
                onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
              },
            )
          } else {
            toast.success(t('team.member_card.toast_saved'))
            onClose()
          }
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  const saving = update.isPending || updateRole.isPending

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {draft.avatar_url ? (
              <img
                src={draft.avatar_url}
                alt={displayName}
                className="border-border bg-muted size-9 shrink-0 rounded-full border object-cover"
              />
            ) : (
              <div className="bg-brand-navy/10 text-brand-navy grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold">
                {initials || <UserIcon className="size-4" strokeWidth={2} />}
              </div>
            )}
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
          {/* Аватар */}
          <div className="flex items-center gap-4">
            {draft.avatar_url ? (
              <img
                src={draft.avatar_url}
                alt={displayName}
                className="border-border bg-muted size-16 rounded-full border object-cover"
              />
            ) : (
              <div className="bg-muted text-foreground grid size-16 place-items-center rounded-full text-lg font-bold">
                {initials || <UserIcon className="size-6" strokeWidth={1.8} />}
              </div>
            )}
            {canEdit ? (
              <div className="flex flex-col gap-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) pickAvatarFile(f)
                    e.target.value = ''
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <Upload className="size-3.5" strokeWidth={2} />
                  )}
                  {t('team.member_card.upload_avatar', { defaultValue: 'Загрузить фото' })}
                </Button>
                <p className="text-muted-foreground text-[11px]">
                  {t('team.member_card.avatar_hint', { defaultValue: 'PNG / JPG / WEBP, до 5 МБ' })}
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">{t('team.member_card.first_name')}</Label>
              <Input
                value={draft.first_name}
                onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))}
                disabled={!canEdit}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">{t('team.member_card.last_name')}</Label>
              <Input
                value={draft.last_name}
                onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))}
                disabled={!canEdit}
                className="mt-1 h-9"
              />
            </div>
            {/* Email — read-only (менять только super-admin через /admin/users) */}
            <div className="sm:col-span-2">
              <Label className="text-xs">{t('team.member_card.email')}</Label>
              <Input
                value={member.email ?? member.invited_email ?? ''}
                readOnly
                className="text-muted-foreground mt-1 h-9 bg-slate-50"
              />
              <p className="text-muted-foreground mt-1 text-[10px]">
                {t('team.member_card.email_readonly')}
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">{t('team.member_card.phone')}</Label>
              <Input
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                disabled={!canEdit}
                placeholder="+48 ..."
                className="mt-1 h-9"
              />
            </div>
            {/* Роль. Owner может изменить себя если в салоне есть второй
                участник — RPC сама проверит инвариант «минимум 1 owner». */}
            <div className="sm:col-span-2">
              <Label className="text-xs">{t('team.role.label')}</Label>
              <Select
                value={draft.role}
                onValueChange={(v) => setDraft((d) => ({ ...d, role: v as SalonRole }))}
                disabled={!canEdit}
              >
                <SelectTrigger className="mt-1 h-9">
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
              <p className="text-muted-foreground mt-1 text-[10px]">
                {t(`team.role_hint.${draft.role}`)}
              </p>
            </div>
          </div>
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            <X className="size-3.5" strokeWidth={2} />
            {t('common.cancel')}
          </Button>
          {canEdit ? (
            <Button variant="primary" size="sm" onClick={save} disabled={saving || uploading}>
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Save className="size-3.5" strokeWidth={2} />
              )}
              {t('common.save')}
            </Button>
          ) : null}
        </div>
      </DialogContent>

      <ImageCropper
        file={cropFile}
        aspect={1}
        maxOutputSize={512}
        onCancel={() => setCropFile(null)}
        onCrop={handleCroppedAvatar}
      />
    </Dialog>
  )
}

const ROLE_TONE: Record<string, string> = {
  owner: 'bg-violet-100 text-violet-700',
  admin: 'bg-sky-100 text-sky-700',
  accountant: 'bg-emerald-100 text-emerald-700',
  staff: 'bg-slate-100 text-slate-700',
}
