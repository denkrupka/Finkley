import { Loader2, Upload, User } from 'lucide-react'
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
 * T25 — форма онбординга мастера после accept-invite. Юзер должен указать:
 *   - Имя, Фамилия (если ещё не заданы при создании со стороны владельца)
 *   - Номер телефона
 *   - Аватар (опционально)
 *   - Дата рождения
 *   - Установить пароль (если впервые входит — Supabase Auth uses magic link
 *     или OTP, а свой пароль ещё не задан)
 *
 * Вызывается из AcceptInvitePage когда accept-invitation успешен, но профиль
 * не заполнен. После сохранения — родитель навигирует на dashboard салона.
 */
export function InviteSignupForm({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data: profile } = useMyProfile()
  const update = useUpdateMyProfile()
  const changePassword = useChangeMyPassword()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [birthday, setBirthday] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [uploading, setUploading] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!profile) return
    if (profile.full_name) {
      const parts = profile.full_name.split(' ')
      setFirstName(parts[0] ?? '')
      setLastName(parts.slice(1).join(' '))
    }
    setPhone(profile.phone ?? '')
    setAvatarUrl(profile.avatar_url)
  }, [profile])

  async function handleUploadAvatar(file: File) {
    if (!user) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('invite_signup.avatar_too_large', { defaultValue: 'Макс. 5 МБ' }))
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
      setAvatarUrl(pub.publicUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
    if (!fullName) {
      toast.error(t('invite_signup.errors.name_required', { defaultValue: 'Укажи имя и фамилию' }))
      return
    }
    if (!phone.trim()) {
      toast.error(
        t('invite_signup.errors.phone_required', { defaultValue: 'Укажи номер телефона' }),
      )
      return
    }
    if (!birthday) {
      toast.error(
        t('invite_signup.errors.birthday_required', {
          defaultValue: 'Укажи дату рождения',
        }),
      )
      return
    }
    if (password.length > 0 && password.length < 8) {
      toast.error(
        t('invite_signup.errors.password_short', {
          defaultValue: 'Пароль должен быть не менее 8 символов',
        }),
      )
      return
    }
    if (password !== password2) {
      toast.error(
        t('invite_signup.errors.password_mismatch', { defaultValue: 'Пароли не совпадают' }),
      )
      return
    }
    setSaving(true)
    try {
      await update.mutateAsync({
        full_name: fullName,
        phone: phone.trim() || null,
        avatar_url: avatarUrl,
      })
      // birthday хранится в auth.user_metadata — пишем туда через updateUser.
      if (birthday) {
        const { error } = await supabase.auth.updateUser({
          data: { birthday },
        })
        if (error) throw error
      }
      if (password) {
        await changePassword.mutateAsync(password)
      }
      toast.success(t('invite_signup.toast_done', { defaultValue: 'Профиль сохранён' }))
      onComplete()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      <header className="text-center">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('invite_signup.title', { defaultValue: 'Заполни профиль' })}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('invite_signup.subtitle', {
            defaultValue: 'Это нужно один раз — потом сможешь поменять в Настройках.',
          })}
        </p>
      </header>

      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="avatar"
            className="border-border bg-muted size-16 rounded-full border object-cover"
          />
        ) : (
          <div className="bg-muted text-foreground grid size-16 place-items-center rounded-full text-lg font-bold">
            {initials || <User className="size-6" strokeWidth={1.8} />}
          </div>
        )}
        <div>
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
            type="button"
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
            {t('invite_signup.upload_avatar', { defaultValue: 'Аватар' })}
          </Button>
          <p className="text-muted-foreground mt-1 text-[11px]">
            {t('invite_signup.avatar_hint', { defaultValue: 'PNG / JPG / WEBP, до 5 МБ' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-first">
            {t('invite_signup.first_name', { defaultValue: 'Имя' })}
          </Label>
          <Input
            id="invite-first"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-last">
            {t('invite_signup.last_name', { defaultValue: 'Фамилия' })}
          </Label>
          <Input
            id="invite-last"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-phone">
            {t('invite_signup.phone', { defaultValue: 'Номер телефона' })}
          </Label>
          <Input
            id="invite-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+48 ..."
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-birthday">
            {t('invite_signup.birthday', { defaultValue: 'Дата рождения' })}
          </Label>
          <Input
            id="invite-birthday"
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-password">
            {t('invite_signup.password', { defaultValue: 'Пароль (мин. 8 символов)' })}
          </Label>
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-password2">
            {t('invite_signup.password_confirm', { defaultValue: 'Повтори пароль' })}
          </Label>
          <Input
            id="invite-password2"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            placeholder="••••••••"
          />
        </div>
      </div>

      <Button type="submit" variant="primary" size="lg" disabled={saving} className="mt-2">
        {saving ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
        {t('invite_signup.submit', { defaultValue: 'Сохранить и войти' })}
      </Button>
    </form>
  )
}
