import type { OnboardingIntegration } from './OnboardingPage'

/**
 * T133 — оригинальные логотипы интеграций (inline SVG).
 *
 * Использовать вместо PlugIconSvg в integration cards. Каждый логотип
 * — упрощённая монохромная версия бренд-марки (8-10 точек bezier),
 * чтобы вписалось в кнопку 36×36 и читалось как фавикон.
 *
 * Для интеграций где нет узнаваемого бренда (banking, ical, ocr_notebook)
 * — используем общий glyph.
 */

type Props = {
  provider: OnboardingIntegration | 'generic'
  className?: string
}

export function BrandIcon({ provider, className = 'size-5' }: Props) {
  switch (provider) {
    case 'booksy':
      return (
        // Booksy — стилизованная буква B
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M5 4h8a5 5 0 0 1 2.6 9.27A5 5 0 0 1 13.5 22H5V4Zm3 3v4h5a2 2 0 0 0 0-4H8Zm0 7v5h5.5a2.5 2.5 0 0 0 0-5H8Z" />
        </svg>
      )
    case 'wfirma':
      return (
        // wFirma — буква W
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M3 5h3.2l1.9 9.6L10.4 5h3.2l2.3 9.6L17.8 5H21l-3.5 14h-3.5L11.7 9.2 9.4 19H5.9L3 5Z" />
        </svg>
      )
    case 'instagram':
      return (
        // Instagram — камера + точка
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5Zm5-3.25a1.25 1.25 0 1 1-1.25 1.25A1.25 1.25 0 0 1 17 6.25Z"
            clipRule="evenodd"
          />
        </svg>
      )
    case 'facebook':
      return (
        // Facebook — буква f
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M13.5 22v-9.5h3.2l.5-3.7h-3.7V6.4c0-1 .3-1.8 1.8-1.8h2V1.2A26.9 26.9 0 0 0 14.4 1c-2.9 0-4.9 1.8-4.9 5v3.8H6.2v3.7h3.3V22h4Z" />
        </svg>
      )
    case 'whatsapp':
      return (
        // WhatsApp — телефон в пузыре
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M20.5 3.5A10 10 0 0 0 3.7 17L2 22l5.2-1.6a10 10 0 0 0 13.3-16.9Zm-8.4 16.4a8.3 8.3 0 0 1-4.2-1.1l-.3-.2-3.1 1 1-3-.2-.3A8.3 8.3 0 1 1 12 19.9ZM16.7 14c-.3-.1-1.6-.8-1.8-.9s-.4-.1-.6.1-.7.9-.8 1.1-.3.2-.5 0a6.6 6.6 0 0 1-2-1.2 7.2 7.2 0 0 1-1.4-1.7c-.1-.3 0-.4.1-.5l.4-.4.2-.3v-.4l-.8-2c-.2-.4-.4-.4-.6-.4h-.5a1.1 1.1 0 0 0-.8.4 3.3 3.3 0 0 0-1 2.5 5.6 5.6 0 0 0 1.2 3c.2.2 2 3 4.8 4.2a16 16 0 0 0 1.6.6 4 4 0 0 0 1.8.1c.5-.1 1.6-.7 1.9-1.3a2.3 2.3 0 0 0 .2-1.3c-.1-.2-.3-.2-.6-.4Z" />
        </svg>
      )
    case 'telegram':
      return (
        // Telegram — бумажный самолётик
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42Z" />
        </svg>
      )
    case 'ical':
      return (
        // Календарь
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    case 'banking':
      return (
        // Здание банка
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
          aria-hidden="true"
        >
          <path d="M3 21h18M3 10h18M5 21V10M12 3 3 10h18l-9-7Zm-3 11v5m6-5v5m-9-5v5" />
        </svg>
      )
    case 'ksef':
      return (
        // KSeF — щит с галочкой (госреестр)
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
          aria-hidden="true"
        >
          <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      )
    case 'fakturownia':
      return (
        // Документ-фактура
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
      )
    case 'ifirma':
      return (
        // iFirma — i + квадрат
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="12" cy="8" r="1.5" />
          <rect x="10.5" y="11" width="3" height="8" rx="1" />
        </svg>
      )
    case 'infakt':
      return (
        // inFakt — папка
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
          aria-hidden="true"
        >
          <path d="M4 4h4l2 3h10v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          <line x1="12" y1="14" x2="16" y2="14" />
        </svg>
      )
    case 'ocr_notebook':
      return (
        // Камера / OCR
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
          aria-hidden="true"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11Z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      )
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
          aria-hidden="true"
        >
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
        </svg>
      )
  }
}

/** Цвет для иконки (используется в bg accent). */
// eslint-disable-next-line react-refresh/only-export-components
export function brandColor(provider: OnboardingIntegration): string {
  switch (provider) {
    case 'booksy':
      return '#0080FF'
    case 'wfirma':
      return '#1976D2'
    case 'instagram':
      return '#E1306C'
    case 'facebook':
      return '#1877F2'
    case 'whatsapp':
      return '#25D366'
    case 'telegram':
      return '#229ED9'
    case 'ksef':
      return '#8B0000'
    case 'fakturownia':
      return '#F26522'
    case 'ifirma':
      return '#00B5AD'
    case 'infakt':
      return '#7B68EE'
    case 'banking':
      return '#0F766E'
    case 'ical':
      return '#FF3B30'
    case 'ocr_notebook':
      return '#0F172A'
    default:
      return '#0F766E'
  }
}
