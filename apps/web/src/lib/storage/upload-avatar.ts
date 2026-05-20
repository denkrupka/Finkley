import { supabase } from '@/lib/supabase/client'

/**
 * Загружает файл аватара в public-bucket `salon-logos` под путём
 * `staff-avatars/{salonId}/{uuid}.{ext}` и возвращает publicUrl.
 * Используется в TeamPage invite modal и в StaffEditSheet для смены фото.
 *
 * Лимиты: до 2 MB, типы image/*. На сервере дополнительной валидации нет
 * (bucket публичный). При неуспехе — throw Error.
 */
export async function uploadStaffAvatar(salonId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('avatar_invalid_type')
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('avatar_too_large')
  }
  const ext =
    file.name
      .split('.')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'jpg'
  const uuid = crypto.randomUUID()
  const path = `staff-avatars/${salonId}/${uuid}.${ext}`

  const { error } = await supabase.storage
    .from('salon-logos')
    .upload(path, file, { upsert: false, cacheControl: '3600' })
  if (error) throw error

  const { data } = supabase.storage.from('salon-logos').getPublicUrl(path)
  return data.publicUrl
}
