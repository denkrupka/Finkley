import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase/client'

/**
 * Профиль текущего юзера из таблицы `profiles` (one-to-one с auth.users).
 * Содержит full_name, avatar_url, locale, telegram_id (если привязан),
 * telegram_username.
 */
export type MyProfile = {
  id: string
  full_name: string | null
  avatar_url: string | null
  locale: string
  telegram_id: number | null
  telegram_username: string | null
  is_tester: boolean
  phone: string | null
  phone_verified_at: string | null
}

export function useMyProfile() {
  const { user } = useAuth()
  return useQuery<MyProfile | null>({
    queryKey: ['my-profile', user?.id ?? 'anon'],
    queryFn: async () => {
      if (!user) return null
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, avatar_url, locale, telegram_id, telegram_username, is_tester, phone, phone_verified_at',
        )
        .eq('id', user.id)
        .maybeSingle()
      if (error) throw error
      return (data as MyProfile | null) ?? null
    },
    enabled: !!user,
    staleTime: 60_000,
  })
}

/**
 * Обновить редактируемые поля профиля текущего юзера: имя, телефон, аватар.
 * Email хранится в auth.users и меняется отдельной операцией supabase.auth
 * (через email change flow), здесь не редактируется.
 */
export function useUpdateMyProfile() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: {
      full_name?: string | null
      phone?: string | null
      avatar_url?: string | null
    }) => {
      if (!user) throw new Error('not_authenticated')
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-profile'] })
    },
  })
}

/** Изменить пароль текущего юзера через Supabase Auth. */
export function useChangeMyPassword() {
  return useMutation({
    mutationFn: async (newPassword: string) => {
      if (newPassword.length < 8) throw new Error('Пароль должен быть не менее 8 символов')
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
    },
  })
}

/**
 * Отвязать Telegram — обнуляем telegram_id/telegram_username. Серверная
 * проверка не нужна, RLS-политика "users can update own profile" разрешает
 * юзеру изменять свой profile.
 */
export function useUnlinkTelegram() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('not_authenticated')
      const { error } = await supabase
        .from('profiles')
        .update({ telegram_id: null, telegram_username: null })
        .eq('id', user.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-profile'] })
    },
  })
}
