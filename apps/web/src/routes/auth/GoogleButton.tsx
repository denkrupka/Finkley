import { useEffect, useRef, useState } from 'react'

import { supabase } from '@/lib/supabase/client'

/**
 * Кнопка «Sign in with Google» через Google Identity Services (GSI) +
 * Supabase `signInWithIdToken`.
 *
 * Зачем не `signInWithOAuth`:
 *   В классическом OAuth-флоу Supabase Google показывает в окне согласия
 *   redirect_uri, который зашит на стороне Supabase Cloud как
 *   `https://<ref>.supabase.co/auth/v1/callback`. Это домен, который нам не
 *   принадлежит, и Google пишет «Переход в supabase.co» вместо «Переход в Finkley».
 *
 *   GSI работает иначе: popup открывается прямо под нашим доменом
 *   `finkley.app`, Google отдаёт нам подписанный id_token, мы передаём его
 *   в Supabase. supabase.co нигде не светится. Бесплатный тариф Supabase это
 *   полностью поддерживает (`auth.signInWithIdToken`).
 *
 * Nonce-flow (защита от replay):
 *   1. Генерим случайный raw_nonce, считаем SHA-256 от него (hashed_nonce)
 *   2. hashed_nonce передаём в Google → он кладёт его в claim `nonce` id_token'а
 *   3. raw_nonce передаём в supabase.auth.signInWithIdToken — Supabase
 *      сам хеширует его и сверяет с claim'ом из токена
 *   Без этого с FedCM получается ошибка
 *   «Passed nonce and nonce in id_token should either both exist or not».
 *
 * Setup:
 * 1. В .env: VITE_GOOGLE_CLIENT_ID=<client_id из Google Cloud OAuth Client>
 * 2. В Google Cloud Console → OAuth Client → Authorized JavaScript origins:
 *    `https://finkley.app`, `http://localhost:5173`
 *    (Authorized redirect URIs для GSI не нужны — popup-flow без редиректа.)
 * 3. В Supabase Dashboard → Authentication → Providers → Google:
 *    `Client ID` (или Authorized Client IDs) равен VITE_GOOGLE_CLIENT_ID,
 *    чтобы Supabase верифицировал id_token, выпущенный нашим клиентом.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

/** Считает SHA-256 от строки и возвращает hex-строку. */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function GoogleButton() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!CLIENT_ID) {
      console.warn('VITE_GOOGLE_CLIENT_ID is not set — Google sign-in is disabled')
      return
    }

    let cancelled = false
    let pollHandle: number | undefined

    async function setup() {
      // Один и тот же raw_nonce живёт всю сессию кнопки, чтобы id_token,
      // полученный из popup'а, прошёл проверку при вызове Supabase.
      const rawNonce = crypto.randomUUID() + crypto.randomUUID()
      const hashedNonce = await sha256Hex(rawNonce)
      if (cancelled) return

      function handleCredential(response: { credential: string }) {
        void supabase.auth
          .signInWithIdToken({
            provider: 'google',
            token: response.credential,
            nonce: rawNonce,
          })
          .then(({ error }) => {
            if (error) {
              console.error('Supabase signInWithIdToken error', error)
              setError(error.message)
              return
            }
            // Сессия подхватится через onAuthStateChange в AuthProvider,
            // редирект из /login сделает RequireAuth.
          })
      }

      function tryRender() {
        if (cancelled) return
        const node = containerRef.current
        if (!node) return
        const gsi = window.google?.accounts?.id
        if (!gsi) {
          pollHandle = window.setTimeout(tryRender, 100)
          return
        }

        gsi.initialize({
          client_id: CLIENT_ID!,
          callback: handleCredential,
          nonce: hashedNonce,
          ux_mode: 'popup',
          auto_select: false,
          itp_support: true,
          use_fedcm_for_button: true,
        })

        const width = Math.min(Math.max(node.offsetWidth, 200), 400)
        gsi.renderButton(node, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
        })
      }

      tryRender()
    }

    void setup()

    const captured = containerRef.current

    return () => {
      cancelled = true
      if (pollHandle !== undefined) window.clearTimeout(pollHandle)
      if (captured) captured.innerHTML = ''
    }
  }, [])

  if (!CLIENT_ID) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={containerRef} className="flex w-full justify-center" data-testid="google-signin" />
      {error ? (
        <p className="text-destructive text-sm font-medium" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
