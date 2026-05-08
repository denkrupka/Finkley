import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * ThemeProvider — управляет dark/light/system темой.
 *
 * - Хранит выбор в `localStorage['finkley-theme']`.
 * - При `'system'` слушает `prefers-color-scheme` и реагирует на изменение.
 * - Кладёт класс `dark` на `<html>` (см. globals.css `.dark { ... }`).
 *
 * Использование:
 *   const { theme, setTheme, resolvedTheme } = useTheme()
 *   theme — выбор юзера (system/dark/light)
 *   resolvedTheme — реально применённая (dark | light)
 */

export type Theme = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (t: Theme) => void
}

const STORAGE_KEY = 'finkley-theme'
const ThemeContext = createContext<ThemeContextValue | null>(null)

function readSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system'
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function applyClass(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  // Также сообщаем браузеру для нативных контролов (scrollbar и т.п.)
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme())
  const [resolvedTheme, setResolved] = useState<'light' | 'dark'>(() => {
    const t = readStoredTheme()
    return t === 'system' ? readSystemTheme() : t
  })

  useEffect(() => {
    const r = theme === 'system' ? readSystemTheme() : theme
    setResolved(r)
    applyClass(r)
  }, [theme])

  // Слушаем изменение OS-темы только если выбран 'system'
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => {
      const r = readSystemTheme()
      setResolved(r)
      applyClass(r)
    }
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [theme])

  function setTheme(t: Theme) {
    setThemeState(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      // private mode etc.
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
