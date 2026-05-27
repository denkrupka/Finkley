import { Loader2, Lock, Upload, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { useChangeMyPassword, useMyProfile, useUpdateMyProfile } from '@/hooks/useMyProfile'
import { supabase } from '@/lib/supabase/client'

/**
 * Блок «Профиль пользователя» внутри /settings → Профиль. Юзер может:
 *   - сменить Имя/Фамилию (full_name)
 *   - указать/изменить номер телефона
 *   - загрузить аватар (Supabase Storage → avatars bucket)
 *   - сменить пароль (Supabase Auth updateUser)
 *
 * Email из auth.users показан как read-only — смена email требует подтверждения
 * по почте и должна делаться отдельным flow, не отсюда.
 */
export function UserProfileCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  const update = useUpdateMyProfile()
  const changePassword = useChangeMyPassword()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!profile) return
    setFullName(profile.full_name ?? '')
    setPhone(profile.phone ?? '')
  }, [profile])

  if (isLoading || !profile) {
    return <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
  }

  const initials = (fullName || profile.full_name || user?.email || '?')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  function handleSaveProfile() {
    update.mutate(
      { full_name: fullName.trim() || null, phone: phone.trim() || null },
      {
        onSuccess: () =>
          toast.success(
            t('settings.user_profile.toast_saved', { defaultValue: 'Профиль обновлён' }),
          ),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function handleChangePassword() {
    if (newPassword.length < 8) {
      toast.error(
        t('settings.user_profile.password_too_short', {
          defaultValue: 'Минимум 8 символов',
        }),
      )
      return
    }
    changePassword.mutate(newPassword, {
      onSuccess: () => {
        toast.success(
          t('settings.user_profile.toast_password_changed', {
            defaultValue: 'Пароль изменён',
          }),
        )
        setNewPassword('')
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    })
  }

  async function handleUploadAvatar(file: File) {
    if (!user) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('settings.user_profile.avatar_too_large', { defaultValue: 'Макс. 5 МБ' }))
      return
    }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${user.id}/avatar-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      await update.mutateAsync({ avatar_url: pub.publicUrl })
      toast.success(
        t('settings.user_profile.toast_avatar_updated', { defaultValue: 'Аватар обновлён' }),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Аватар */}
      <div className="flex items-center gap-4">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt="avatar"
            className="border-border bg-muted size-16 rounded-full border object-cover"
          />
        ) : (
          <div className="bg-muted text-foreground grid size-16 place-items-center rounded-full text-lg font-bold">
            {initials || <User className="size-6" strokeWidth={1.8} />}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleUploadAvatar(f)
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
            {t('settings.user_profile.upload_avatar', { defaultValue: 'Загрузить аватар' })}
          </Button>
          <p className="text-muted-foreground text-[11px]">PNG / JPG / WEBP, до 5 МБ</p>
        </div>
      </div>

      {/* Имя / Фамилия */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="user-name">
            {t('settings.user_profile.name_label', { defaultValue: 'Имя и фамилия' })}
          </Label>
          <Input
            id="user-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Иван Иванов"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-phone">
            {t('settings.user_profile.phone_label', { defaultValue: 'Номер телефона' })}
          </Label>
          <Input
            id="user-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+48 ..."
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-email">Email</Label>
          <Input id="user-email" value={user?.email ?? ''} disabled readOnly />
          <p className="text-muted-foreground text-[11px]">
            {t('settings.user_profile.email_hint', {
              defaultValue: 'Изменить email можно через поддержку',
            })}
          </p>
        </div>
      </div>

      <div>
        <Button variant="primary" size="md" onClick={handleSaveProfile} disabled={update.isPending}>
          {update.isPending ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
          {t('common.save')}
        </Button>
      </div>

      {/* Смена пароля */}
      <div className="border-border border-t pt-4">
        <h3 className="text-foreground mb-2 inline-flex items-center gap-1.5 text-sm font-bold">
          <Lock className="size-3.5" strokeWidth={2} />
          {t('settings.user_profile.password_title', { defaultValue: 'Сменить пароль' })}
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="user-new-password">
              {t('settings.user_profile.new_password_label', { defaultValue: 'Новый пароль' })}
            </Label>
            <Input
              id="user-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          <Button
            variant="outline"
            size="md"
            onClick={handleChangePassword}
            disabled={changePassword.isPending || newPassword.length < 8}
          >
            {changePassword.isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : null}
            {t('settings.user_profile.change_password', { defaultValue: 'Изменить пароль' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
