import { useMutation } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type OcrParsedReceipt = {
  amount: number | null
  amount_net: number | null
  vat_rate: number | null
  vat_amount: number | null
  currency: string | null
  expense_at: string | null
  vendor: string | null
  vendor_nip: string | null
  /** Адрес продавца с фактуры — нужен для авто-создания контрагента (image #93). */
  vendor_address: string | null
  buyer_nip: string | null
  category_guess: string | null
  /** Номер документа (FV/.../..., paragon №...) — для expenses.document_number. */
  document_number: string | null
  /** IBAN счёта продавца — для bulk-перевода. Null для paragon-чеков без счёта. */
  vendor_iban: string | null
  /** AI-краткое описание сути расхода на русском (2-5 слов) на основе позиций фактуры.
   *  Идёт в expense.description вместо vendor name (bug 03.06 Денис). */
  description: string | null
  raw_text: string | null
}

/**
 * Конвертирует File в base64 без data: префикса (нужно для Anthropic vision).
 * Использует FileReader.readAsDataURL → срезает префикс.
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      // result = "data:image/jpeg;base64,xxxx"
      const idx = result.indexOf(',')
      resolve(idx > 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * OCR чека через edge function ocr-receipt → Claude Haiku 4.5 vision.
 * Возвращает structured данные для предзаполнения формы расхода.
 *
 * Используется в ExpenseFormModal: юзер тапает «📷 Сфоткать чек», выбирает
 * фото, мы шлём в OCR → автозаполняем поля, юзер подтверждает/правит и сохраняет.
 */
export function useOcrReceipt() {
  return useMutation<OcrParsedReceipt, Error, File>({
    mutationFn: async (file) => {
      // Защита от слишком больших файлов. PDF фактуры обычно <2MB, фото <4MB.
      // Edge function в свою очередь rejects >8MB после base64-decode.
      if (file.size > 6 * 1024 * 1024) {
        throw new Error('file_too_large')
      }
      const image_base64 = await fileToBase64(file)
      const { data, error } = await supabase.functions.invoke('ocr-receipt', {
        body: { image_base64, mime: file.type || 'image/jpeg' },
      })
      if (error) throw error
      const json = data as { ok: boolean; result?: OcrParsedReceipt; error?: string }
      if (!json.ok || !json.result) throw new Error(json.error ?? 'ocr_failed')
      return json.result
    },
  })
}
