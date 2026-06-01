import { LifeBuoy, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

/**
 * Баннер «режим HelpDesk» — показывается super-admin'у когда он зашёл в
 * чужой салон через AdminSalonsPage → action 'helpdesk'.
 *
 * Источник правды: sessionStorage['finkley:helpdesk-mode'] = {salon_id, salon_name}.
 * Cтавится при клике HelpDesk. Снимается при «Выйти из режима HelpDesk».
 *
 * Кнопка «Назад в админку» → navigate('/admin/overview') + удаляет флаг.
 */
export function HelpDeskBanner() {
  const navigate = useNavigate()
  const { salonId } = useParams<{ salonId: string }>()
  const [state, setState] = useState<{ salon_id: string; salon_name: string } | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem('finkley:helpdesk-mode')
    if (!raw) {
      setState(null)
      return
    }
    try {
      const parsed = JSON.parse(raw) as { salon_id: string; salon_name?: string }
      if (parsed.salon_id !== salonId) {
        // Зашли в другой салон — режим больше не активен.
        window.sessionStorage.removeItem('finkley:helpdesk-mode')
        setState(null)
        return
      }
      setState({ salon_id: parsed.salon_id, salon_name: parsed.salon_name ?? '' })
    } catch {
      setState(null)
    }
  }, [salonId])

  if (!state) return null

  return (
    <div className="bg-brand-yellow border-brand-yellow-deep sticky top-0 z-50 flex items-center justify-between gap-3 border-b px-4 py-2">
      <div className="text-brand-navy flex items-center gap-2 text-sm font-bold">
        <LifeBuoy className="size-4" strokeWidth={2.2} />
        <span>
          Режим HelpDesk · ты в кабинете
          {state.salon_name ? ` «${state.salon_name}»` : ''} как помощник
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          window.sessionStorage.removeItem('finkley:helpdesk-mode')
          navigate('/admin/overview')
        }}
        className="bg-brand-navy text-brand-yellow hover:bg-brand-navy/80 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors"
      >
        <X className="size-3.5" strokeWidth={2.4} />
        Назад в админку
      </button>
    </div>
  )
}
