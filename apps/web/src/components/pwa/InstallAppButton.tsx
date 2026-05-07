import { Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

/**
 * Кнопка ручного запуска install-prompt PWA. Браузеры скрывают встроенный
 * promote-bar, но дают beforeinstallprompt event — мы его ловим и показываем
 * нашу кнопку.
 *
 * Поведение:
 * - В iOS Safari события нет; показываем подсказку «через меню Поделиться».
 * - Если приложение уже запущено в standalone-режиме, кнопка скрыта.
 * - После успешного install кнопка пропадает.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallAppButton() {
  const { t } = useTranslation()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)
    setIsIOS(/iPhone|iPad|iPod/.test(navigator.userAgent))

    function onPrompt(e: Event) {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    function onInstalled() {
      setIsInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Уже установлено / запущено как PWA — кнопка не нужна
  if (isStandalone || isInstalled) {
    return (
      <p className="text-muted-foreground text-sm">{t('settings.install.already_installed')}</p>
    )
  }

  // iOS Safari — нет beforeinstallprompt, только инструкция
  if (isIOS && !deferred) {
    return <p className="text-muted-foreground text-sm">{t('settings.install.ios_hint')}</p>
  }

  if (!deferred) {
    return <p className="text-muted-foreground text-sm">{t('settings.install.not_available')}</p>
  }

  return (
    <Button
      variant="outline"
      size="md"
      onClick={async () => {
        await deferred.prompt()
        const choice = await deferred.userChoice
        if (choice.outcome === 'accepted') {
          setDeferred(null)
        }
      }}
    >
      <Smartphone className="size-4" strokeWidth={1.7} />
      {t('settings.install.button')}
    </Button>
  )
}
