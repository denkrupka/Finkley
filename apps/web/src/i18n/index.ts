import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import pl from './locales/pl.json'
import ru from './locales/ru.json'

/**
 * RU — основная локаль (наполнение 100%). EN/PL — переведена критичная
 * навигация, авторизация, настройки. Для отсутствующих ключей i18next
 * автоматически делает fallback на RU. Полный перевод EN/PL делается
 * по мере роста PL и EN-юзеров через batch-перевод (Claude API).
 */
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
      pl: { translation: pl },
    },
    fallbackLng: 'ru',
    supportedLngs: ['ru', 'en', 'pl'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

export default i18n
