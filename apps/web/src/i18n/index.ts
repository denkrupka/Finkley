import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import ru from './locales/ru.json'

/**
 * RU — основная локаль (~230KB JSON), грузится eagerly как fallback и
 * стартовый язык. EN/PL подтягиваются динамически при смене языка через
 * LocaleSwitcher или useI18nSync (по profile.locale). Это убирает ~150KB
 * (raw, ~50KB gzip) из initial bundle для RU-юзеров — самый частый кейс.
 *
 * Логика загрузки:
 *   1. i18next.init() с одним RU resource bundle и fallbackLng='ru'.
 *   2. После init слушаем languageChanged → fetch'аем JSON через dynamic
 *      import (Vite сделает отдельный chunk per locale).
 *   3. Если детектор уже выбрал не-RU при первом запуске — этот же
 *      обработчик подтянет нужный.
 *
 * Pattern: до загрузки соответствующего ru-fallback bundle ключи EN/PL
 * показываются как RU. Это <50ms на типичном соединении (chunk ~30KB gzip).
 */

const LAZY_LOCALES: Record<string, () => Promise<unknown>> = {
  en: () => import('./locales/en.json'),
  pl: () => import('./locales/pl.json'),
}

async function ensureLocaleLoaded(lng: string): Promise<void> {
  // Базовый язык (отсекаем регион типа en-GB → en).
  const base = lng.split('-')[0]
  if (!base) return
  if (i18n.hasResourceBundle(base, 'translation')) return
  const loader = LAZY_LOCALES[base]
  if (!loader) return
  try {
    const mod = (await loader()) as { default?: Record<string, unknown> } & Record<string, unknown>
    const data = (mod.default ?? mod) as Record<string, unknown>
    i18n.addResourceBundle(base, 'translation', data, true, true)
  } catch (err) {
    console.warn(`i18n: failed to load locale ${base}`, err)
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
    },
    fallbackLng: 'ru',
    supportedLngs: ['ru', 'en', 'pl'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })
  .then(() => {
    // Если детектор выбрал EN/PL — догружаем сразу. Иначе ждём смены языка.
    void ensureLocaleLoaded(i18n.language)
  })

// При каждой смене языка пробуем подгрузить если ещё не загружен.
i18n.on('languageChanged', (lng: string) => {
  void ensureLocaleLoaded(lng)
})

export default i18n
