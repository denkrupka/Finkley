/**
 * Минимальные типы для Google Identity Services (`accounts.google.com/gsi/client`).
 * Используется в GoogleButton для FedCM-флоу с popup'ом и id_token,
 * чтобы Google показывал «Sign in to Finkley», а не Supabase-домен.
 *
 * Полная спецификация: https://developers.google.com/identity/gsi/web/reference/js-reference
 */
export {}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: GsiInitConfig): void
          renderButton(parent: HTMLElement, opts: GsiButtonOptions): void
          prompt(): void
          cancel(): void
          disableAutoSelect(): void
        }
      }
    }
  }
}

interface GsiCredentialResponse {
  credential: string
  select_by?: string
  clientId?: string
}

interface GsiInitConfig {
  client_id: string
  callback: (response: GsiCredentialResponse) => void
  auto_select?: boolean
  ux_mode?: 'popup' | 'redirect'
  login_uri?: string
  itp_support?: boolean
  use_fedcm_for_prompt?: boolean
  use_fedcm_for_button?: boolean
  nonce?: string
}

interface GsiButtonOptions {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  width?: number
  locale?: string
}
