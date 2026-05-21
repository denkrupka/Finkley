import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useMyProfile } from '@/hooks/useMyProfile'

const SUPPORTED = new Set(['ru', 'en', 'pl'])

/**
 * Синхронизирует язык интерфейса с `profiles.locale` после загрузки сессии.
 *
 * Логика:
 * - profile.locale — авторитативный источник (юзер выбирает локаль в
 *   онбординге / в LocaleSwitcher → мы сохраняем в profiles).
 * - Если profile.locale отличается от i18n.language, переключаем.
 * - Если profile.locale пустой / unsupported — оставляем текущий
 *   (i18next-browser-languagedetector уже подобрал из localStorage / navigator).
 *
 * Без этого хука язык, выбранный в онбординге, не применялся — i18next
 * читал только localStorage / navigator и игнорировал БД-настройку.
 */
export function useI18nSync(): void {
  const { i18n } = useTranslation()
  const { data: profile } = useMyProfile()

  useEffect(() => {
    const target = profile?.locale
    if (!target) return
    if (!SUPPORTED.has(target)) return
    if (i18n.language === target) return
    void i18n.changeLanguage(target)
  }, [profile?.locale, i18n])
}
