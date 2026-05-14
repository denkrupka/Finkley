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
}

export function useMyProfile() {
  const { user } = useAuth()
  return useQuery<MyProfile | null>({
    queryKey: ['my-profile', user?.id ?? 'anon'],
    queryFn: async () => {
      if (!user) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, locale, telegram_id, telegram_username')
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
