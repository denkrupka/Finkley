import { ImagePlus, Loader2, Trash2, User } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Field } from '@/components/ui/field'
import { ImageCropper } from '@/components/ui/ImageCropper'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase/client'

type Props = {
  value: {
    first_name: string
    last_name: string
    avatar_data_url: string | null
  }
  onChange: (v: Partial<Props['value']>) => void
}

/**
 * T96 — шаг профиля пользователя в начале онбординга.
 * Имя и фамилия — обязательны для обращения в письмах/Telegram.
 * Аватар — optional. Если выбран — через cropper (1:1, 512px webp).
 *
 * Аватар грузится СРАЗУ при выборе (юзер аутентифицирован с начала онбординга) —
 * в avatars bucket (RLS требует auth.uid() в пути) + profiles.avatar_url. Раньше
 * аватар откладывался как base64 data URL до submit, где терялся (autosave
 * раздувал onboarding_state, а upload падал молча → avatar_url=NULL). Теперь
 * avatar_data_url хранит уже публичный URL; fallback на data URL, если аплоад
 * не удался (submit попробует ещё раз).
 */
export function StepUserProfile({ value, onChange }: Props) {
  const { t } = useTranslation()
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  }

  const initials = `${value.first_name[0] ?? ''}${value.last_name[0] ?? ''}`.toUpperCase()

  return (
    <div>
      <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
        {t('onboarding.profile.title')}
      </h1>

      <div className="mt-3 flex flex-col gap-3">
        {/* Аватар */}
        <div className="flex items-center gap-4">
          {value.avatar_data_url ? (
            <img
              src={value.avatar_data_url}
              alt="avatar"
              className="border-border bg-muted size-20 rounded-full border object-cover"
            />
          ) : (
            <div className="bg-muted text-foreground grid size-20 place-items-center rounded-full text-2xl font-bold">
              {initials || <User className="size-8" strokeWidth={1.8} />}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              if (f.size > 5 * 1024 * 1024) {
                toast.error(t('onboarding.profile.avatar_too_large'))
                e.target.value = ''
                return
              }
              setCropFile(f)
              e.target.value = ''
            }}
          />
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="border-border bg-card hover:bg-muted/40 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <ImagePlus className="size-3.5" strokeWidth={2} />
              )}
              {value.avatar_data_url
                ? t('onboarding.profile.avatar_change')
                : t('onboarding.profile.avatar_upload')}
            </button>
            {value.avatar_data_url ? (
              <button
                type="button"
                onClick={() => onChange({ avatar_data_url: null })}
                className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1.5 self-start text-xs"
              >
                <Trash2 className="size-3" strokeWidth={1.8} />
                {t('onboarding.profile.avatar_remove')}
              </button>
            ) : (
              <p className="text-muted-foreground text-[11px]">
                {t('onboarding.profile.avatar_hint')}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="onb-first" label={t('onboarding.profile.first_name')}>
            <Input
              id="onb-first"
              value={value.first_name}
              onChange={(e) => onChange({ first_name: e.target.value })}
              placeholder={t('onboarding.profile.first_name_placeholder')}
              autoComplete="given-name"
              autoFocus
            />
          </Field>
          <Field id="onb-last" label={t('onboarding.profile.last_name')}>
            <Input
              id="onb-last"
              value={value.last_name}
              onChange={(e) => onChange({ last_name: e.target.value })}
              placeholder={t('onboarding.profile.last_name_placeholder')}
              autoComplete="family-name"
            />
          </Field>
        </div>
      </div>

      <ImageCropper
        file={cropFile}
        aspect={1}
        maxOutputSize={512}
        onCancel={() => setCropFile(null)}
        onCrop={async (blob) => {
          setBusy(true)
          try {
            // Грузим СРАЗУ в avatars bucket + profiles.avatar_url (юзер уже
            // аутентифицирован). avatar_data_url держит публичный URL — submit
            // его не перезагружает (грузит только data:-URL).
            const { data: u } = await supabase.auth.getUser()
            const userId = u.user?.id
            if (userId) {
              const path = `${userId}/avatar-${Date.now()}.webp`
              const up = await supabase.storage
                .from('avatars')
                .upload(path, blob, { upsert: true, contentType: 'image/webp' })
              if (up.error) throw up.error
              const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
              await supabase.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', userId)
              onChange({ avatar_data_url: pub.publicUrl })
            } else {
              onChange({ avatar_data_url: await blobToDataUrl(blob) })
            }
            setCropFile(null)
          } catch (err) {
            // Fallback: храним data URL, submit попробует загрузить ещё раз.
            console.warn('avatar immediate upload failed, fallback to data url', err)
            try {
              onChange({ avatar_data_url: await blobToDataUrl(blob) })
              setCropFile(null)
            } catch {
              toast.error(t('onboarding.profile.avatar_too_large'))
            }
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}
