import { Mic, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

type Props = {
  onAudio: (blob: Blob) => void | Promise<void>
  disabled?: boolean
  /** Подпись на кнопке в обычном режиме. По умолчанию i18n key dictate.start. */
  startLabelKey?: string
  /** Подпись на кнопке во время записи. По умолчанию dictate.stop. */
  stopLabelKey?: string
  className?: string
  /** Загружается-ли парсинг ответа на бэке — внешнее состояние от useMutation.
   *  Когда true, кнопка показывает spinner и заблокирована. */
  pending?: boolean
}

/**
 * Кнопка «Микрофон» для голосовой надиктовки. При первом клике запрашивает
 * mic permission и стартует запись через MediaRecorder. На второй клик
 * остановливает запись и отдаёт Blob в onAudio.
 *
 * Используется в ExpenseFormModal для image #93: юзер диктует расход
 * голосом, edge function dictate-expense расшифровывает + парсит поля.
 */
export function DictateButton({
  onAudio,
  disabled,
  startLabelKey = 'dictate.start',
  stopLabelKey = 'dictate.stop',
  className,
  pending,
}: Props) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const cleanup = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      /* noop */
    }
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
  }, [])

  useEffect(() => cleanup, [cleanup])

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4'
      const rec = new MediaRecorder(stream, { mimeType })
      recorderRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        cleanup()
        setRecording(false)
        if (blob.size === 0) {
          toast.error(t('dictate.empty'))
          return
        }
        try {
          await onAudio(blob)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e))
        }
      }
      rec.start()
      setRecording(true)
    } catch (e) {
      toast.error(
        e instanceof Error && e.name === 'NotAllowedError'
          ? t('dictate.permission_denied')
          : e instanceof Error
            ? e.message
            : String(e),
      )
      cleanup()
      setRecording(false)
    }
  }

  function stop() {
    try {
      recorderRef.current?.stop()
    } catch {
      cleanup()
      setRecording(false)
    }
  }

  return (
    <Button
      type="button"
      variant={recording ? 'destructive' : 'outline'}
      disabled={disabled || pending}
      onClick={recording ? stop : start}
      className={cn('inline-flex items-center gap-2', className)}
      aria-pressed={recording}
    >
      {recording ? (
        <>
          <Square className="size-4 animate-pulse" strokeWidth={2.4} />
          {t(stopLabelKey)}
        </>
      ) : (
        <>
          <Mic className="size-4" strokeWidth={2} />
          {t(startLabelKey)}
        </>
      )}
    </Button>
  )
}
