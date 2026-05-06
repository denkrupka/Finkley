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
 * Setup:
 * 1. В .env: VITE_GOOGLE_CLIENT_ID=<client_id из Google Cloud OAuth Client>
 * 2. В Google Cloud Console → OAuth Client → Authorized JavaScript origins:
 *    `https://finkley.app`, `http://localhost:5173`
 *    (Authorized redirect URIs для GSI не нужны — popup-flow без редиректа.)
 * 3. В Supabase Dashboard → Authentication → Providers → Google:
 *    в поле «Authorized Client IDs» добавить тот же VITE_GOOGLE_CLIENT_ID.
 *    Это нужно, чтобы Supabase верифицировал id_token, выпущенный нашим
 *    Google-клиентом.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

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

    function handleCredential(response: { credential: string }) {
      void supabase.auth
        .signInWithIdToken({
          provider: 'google',
          token: response.credential,
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

    function init() {
      if (cancelled) return
      const node = containerRef.current
      if (!node) return
      const gsi = window.google?.accounts?.id
      if (!gsi) {
        // GSI ещё не догрузился, попробуем через 100мс
        pollHandle = window.setTimeout(init, 100)
        return
      }

      gsi.initialize({
        client_id: CLIENT_ID!,
        callback: handleCredential,
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

    init()

    // Сохраняем ссылку на DOM-узел для cleanup'а (containerRef.current
     // к моменту cleanup может уже быть null из-за ремоунта).
    const captured = containerRef.current

    return () => {
      cancelled = true
      if (pollHandle !== undefined) window.clearTimeout(pollHandle)
      // Очищаем содержимое — Google вставляет iframe, при ремоунте дублируется
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
