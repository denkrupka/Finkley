import { useMutation } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type DictatedExpense = {
  amount: number | null
  expense_at: string | null
  category_guess: string | null
  vendor_guess: string | null
  document_number: string | null
  comment: string | null
}

export type DictateResult = {
  transcript: string
  parsed: DictatedExpense | null
}

/**
 * Отправляет аудио-blob в edge function `dictate-expense`.
 * Возвращает транскрипцию и распарсенные поля для подстановки в форму.
 */
export function useDictateExpense() {
  return useMutation<DictateResult, Error, Blob>({
    mutationFn: async (audio: Blob) => {
      const form = new FormData()
      // Имя файла важно для Whisper — он использует расширение для типа.
      const ext = audio.type.includes('webm') ? 'webm' : audio.type.includes('mp4') ? 'mp4' : 'wav'
      form.append('audio', audio, `dictation.${ext}`)
      const { data, error } = await supabase.functions.invoke('dictate-expense', { body: form })
      if (error) throw error
      const res = data as {
        ok?: boolean
        transcript?: string
        parsed?: DictatedExpense | null
        error?: string
      }
      if (!res?.ok) throw new Error(res?.error ?? 'dictate_failed')
      return { transcript: res.transcript ?? '', parsed: res.parsed ?? null }
    },
  })
}
