import { useCallback, useEffect, useState } from 'react'

/**
 * Запоминает состояние сворачивания виджета дашборда в localStorage.
 * Ключ: `dashboard.collapsed.<id>`. Значение '1' = collapsed, '0' = open.
 * Если значение не сохранено — возвращает defaultOpen.
 */
export function usePersistedCollapse(id: string, defaultOpen = true) {
  const storageKey = `dashboard.collapsed.${id}`
  const [open, setOpenState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return defaultOpen
    return raw === '0'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(storageKey, open ? '0' : '1')
  }, [open, storageKey])
  const toggle = useCallback(() => setOpenState((v) => !v), [])
  return { open, setOpen: setOpenState, toggle }
}
