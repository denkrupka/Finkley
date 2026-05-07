import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import App from './App'
import { AuthProvider } from './components/auth/AuthProvider'
import './i18n'
import './styles/globals.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'

// Sentry лениво: ~30KB gzip. Init после первого paint (через requestIdleCallback
// или fallback таймер). Жертвуем catching ошибок самой первой 100мс работы —
// они в любом случае в console и редки.
if (import.meta.env.VITE_SENTRY_DSN) {
  const initSentry = async () => {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      beforeSend(event) {
        if (event.request?.headers) {
          delete event.request.headers['authorization']
          delete event.request.headers['cookie']
        }
        return event
      },
    })
  }
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => void initSentry(), { timeout: 2000 })
  } else {
    setTimeout(() => void initSentry(), 100)
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// SPA fallback unwrap: если попали через 404.html → /app/?p=<encoded>,
// разворачиваем обратно в нормальный URL до того как BrowserRouter
// прочитает location. Без этого юзер видит корень вместо целевого роута.
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search)
  const p = params.get('p')
  if (p) {
    params.delete('p')
    const rest = params.toString()
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const newUrl = `${base}/${p}${rest ? '?' + rest : ''}${window.location.hash}`
    window.history.replaceState(null, '', newUrl)
  }
}

// PWA service worker. Регистрация только в проде — в dev SW мешает HMR.
// Скоп = base path (`/app/`), путь до sw.js — относительно корня.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL }).catch((err) => {
      console.warn('SW registration failed', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <App />
          <Toaster position="bottom-right" richColors closeButton />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
