/**
 * hCaptcha invisible loader. Подгружает https://js.hcaptcha.com/1/api.js
 * один раз и возвращает интерфейс window.hcaptcha. Используется в
 * BooksyConnectDialog (Метод 3 — proxy form): юзер вводит email/password,
 * мы решаем капчу на клиенте через тот же sitekey что у Booksy фронта,
 * передаём токен в edge function, тот делает прямой POST в Booksy API.
 *
 * Sitekey заимствован у Booksy (он не привязан к домену в их конфиге —
 * проверено эмпирически). Если перестанет работать — будем поднимать
 * Playwright-сервис как fallback.
 */

const HCAPTCHA_SCRIPT_URL = 'https://js.hcaptcha.com/1/api.js?render=explicit'

declare global {
  interface Window {
    hcaptcha?: {
      render: (
        container: string | HTMLElement,
        params: {
          sitekey: string
          size?: 'invisible' | 'normal' | 'compact'
          theme?: 'dark' | 'light'
          callback?: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
        },
      ) => string | number
      execute: (
        widgetId: string | number,
        opts?: { async?: boolean },
      ) => Promise<{ response: string }>
      reset: (widgetId: string | number) => void
      remove: (widgetId: string | number) => void
    }
  }
}

let loadPromise: Promise<void> | null = null

export function loadHCaptcha(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no_window'))
  if (window.hcaptcha) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${HCAPTCHA_SCRIPT_URL.split('?')[0]}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('hcaptcha_script_load_failed')))
      // Возможно уже загружен
      if (window.hcaptcha) resolve()
      return
    }
    const s = document.createElement('script')
    s.src = HCAPTCHA_SCRIPT_URL
    s.async = true
    s.defer = true
    s.onload = () => {
      // hcaptcha API становится доступен сразу после load
      const t0 = Date.now()
      const tick = () => {
        if (window.hcaptcha) return resolve()
        if (Date.now() - t0 > 5000) return reject(new Error('hcaptcha_init_timeout'))
        setTimeout(tick, 50)
      }
      tick()
    }
    s.onerror = () => reject(new Error('hcaptcha_script_load_failed'))
    document.head.appendChild(s)
  })

  return loadPromise
}

export const BOOKSY_HCAPTCHA_SITEKEY = '2a8dae97-de60-44fe-b289-b775a2616846'
