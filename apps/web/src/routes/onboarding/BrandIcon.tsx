import type { OnboardingIntegration } from './OnboardingPage'

/**
 * T133+T167 — оригинальные логотипы интеграций (inline SVG из simple-icons).
 *
 * Brand glyphs скопированы из simple-icons.org — CC0 1.0 Universal license
 * (https://github.com/simple-icons/simple-icons/blob/master/LICENSE.md).
 * Path data: Instagram, Facebook, WhatsApp, Telegram. Версия на дату
 * 2026-05-29. Если будем обновлять — взять свежие из npm-пакета
 * simple-icons. Trademark усмотрение: бренды Meta/Booksy/Telegram/etc.
 * принадлежат их владельцам; SVG используем по фейр-юс для UI-индикаторов
 * подключённых интеграций, без коммерческого использования брендов.
 *
 * Для интеграций без узнаваемого бренда (banking, ical, ocr_notebook) —
 * используем абстрактные lucide-style glyphs.
 */

type Props = {
  provider: OnboardingIntegration | 'generic'
  className?: string
}

export function BrandIcon({ provider, className = 'size-5' }: Props) {
  switch (provider) {
    case 'booksy':
      return (
        // Booksy — розовый квадрат-приложение со стилизованной "b". Узнаваемая
        // форма иконки приложения (закруглённый квадрат) + lowercase b.
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="5.4" fill="#FF0073" />
          <path
            d="M9.2 6.5v5.05c.7-.78 1.7-1.27 2.9-1.27 2.42 0 4.1 1.92 4.1 4.36 0 2.43-1.68 4.36-4.1 4.36-1.2 0-2.2-.5-2.9-1.28v1.03H6.6V6.5h2.6Zm2.55 9.92c1.18 0 2.04-.88 2.04-2.13 0-1.26-.86-2.13-2.04-2.13-1.18 0-2.04.87-2.04 2.13 0 1.25.86 2.13 2.04 2.13Z"
            fill="#fff"
          />
        </svg>
      )
    case 'wfirma':
      return (
        // wFirma — синий квадрат со стилизованной 'w' (продолговатые штрихи
        // как в реальном лого).
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#005CA9" />
          <path
            d="M3.6 7.2h2.7l1.6 6.4 1.7-6.4h2.4l1.7 6.4 1.6-6.4h2.7l-2.8 9.6h-2.7L9 11l-1.4 5.8H4.9L2.1 7.2h1.5Z"
            transform="translate(1.7 -.4)"
            fill="#fff"
          />
        </svg>
      )
    case 'instagram':
      return (
        // Instagram — официальный simple-icons path
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
        </svg>
      )
    case 'facebook':
      return (
        // Facebook — официальный simple-icons path
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
        </svg>
      )
    case 'whatsapp':
      return (
        // WhatsApp — официальный simple-icons path
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488" />
        </svg>
      )
    case 'telegram':
      return (
        // Telegram — официальный simple-icons path
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
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
        // KSeF — государственный реестр e-фактур Минфина PL. Тёмно-красный
        // щит (мин-финансовый) + текст KSeF белым. Не официальный лого
        // (его нет), но узнаваемый паттерн "MF + e-faktura shield".
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M12 1.5 3 4.2v6.3c0 5.3 3.6 9.8 9 11.5 5.4-1.7 9-6.2 9-11.5V4.2L12 1.5Z"
            fill="#8B0000"
          />
          <text
            x="12"
            y="14.5"
            textAnchor="middle"
            fontSize="6.5"
            fontWeight="700"
            fill="#fff"
            fontFamily="Inter, system-ui, sans-serif"
          >
            KSeF
          </text>
        </svg>
      )
    case 'fakturownia':
      return (
        // Fakturownia — оранжевый квадрат, белая 'f' (lowercase) + "tick"-волна
        // как в их официальной иконке.
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#F26522" />
          <path
            d="M13.5 6.2c-1.7 0-2.8 1-2.8 2.8v1.6H8.5v2.2h2.2v6h2.5v-6h2.6v-2.2h-2.6V9.4c0-.7.3-1 1-1h1.7V6.2h-2.4Z"
            fill="#fff"
          />
        </svg>
      )
    case 'ifirma':
      return (
        // iFirma — зелёный квадрат с белой 'i' (lowercase) — узнаваемая
        // форма из их иконки приложения.
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#00A651" />
          <circle cx="12" cy="7.2" r="1.7" fill="#fff" />
          <rect x="10.3" y="10.5" width="3.4" height="9" rx="1" fill="#fff" />
        </svg>
      )
    case 'infakt':
      return (
        // inFakt — фиолетовый квадрат с белой 'iF' / документной графикой.
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#7B68EE" />
          <text
            x="12"
            y="15.5"
            textAnchor="middle"
            fontSize="8"
            fontWeight="700"
            fill="#fff"
            fontFamily="Inter, system-ui, sans-serif"
          >
            iF
          </text>
        </svg>
      )
    case 'fresha':
      return (
        // Fresha — оранжевый квадрат с белой "F".
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#FF7657" />
          <path d="M8 6.5h8v2.4h-5.2v3.1h4.6v2.3h-4.6V19H8V6.5Z" fill="#fff" />
        </svg>
      )
    case 'treatwell':
      return (
        // Treatwell — фиолетовый квадрат с белой "tw".
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#5B3FBF" />
          <text
            x="12"
            y="15.5"
            textAnchor="middle"
            fontSize="9"
            fontWeight="800"
            fill="#fff"
            fontFamily="Inter, system-ui, sans-serif"
          >
            tw
          </text>
        </svg>
      )
    case 'yclients':
      return (
        // YCLIENTS — синий квадрат с белой "Y".
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#5183F5" />
          <path d="M6.5 6.5h3.1l2.4 5.4 2.4-5.4h3.1L13 14v5h-2.6v-5L6.5 6.5Z" fill="#fff" />
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

/** True если SVG сам рисуется в брендовом цвете (full-color glyph) — в
 *  карточках бренда такая иконка ставится на белый фон, а не на цветной
 *  bg, чтобы не было «двойного» цвета. Для упрощённых glyph'ов
 *  (banking/ical/ocr_notebook) используем bg=brandColor + currentColor. */
// eslint-disable-next-line react-refresh/only-export-components
export function isFullColorBrand(provider: OnboardingIntegration): boolean {
  switch (provider) {
    case 'booksy':
    case 'wfirma':
    case 'ksef':
    case 'fakturownia':
    case 'ifirma':
    case 'infakt':
    case 'fresha':
    case 'treatwell':
    case 'yclients':
      return true
    default:
      // instagram/facebook/whatsapp/telegram — simple-icons currentColor
      // glyph (не self-colored): рендерим белым на брендовом bg.
      return false
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
    case 'fresha':
      return '#FF7657'
    case 'treatwell':
      return '#5B3FBF'
    case 'yclients':
      return '#5183F5'
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
