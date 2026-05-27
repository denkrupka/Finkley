import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { usePermissions } from '@/hooks/usePermissions'

/**
 * T36 — обёртка для роутов, требующих view-доступа в permissions матрице.
 * Если юзер не имеет доступа — редирект на /:salonId/dashboard + toast.
 *
 * Owner/admin всегда проходят (см. usePermissions). Пока membership грузится —
 * показываем children (оптимистично; редирект случится после первой проверки).
 *
 * Использование в App.tsx:
 *   <Route path="income" element={<RequirePermission category="income"><IncomePage /></RequirePermission>} />
 */
export function RequirePermission({
  category,
  sub,
  children,
}: {
  category: string
  sub?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { can, isLoaded } = usePermissions(salonId)

  const allowed = !isLoaded || can(category, sub)

  useEffect(() => {
    if (isLoaded && !allowed) {
      toast.error(
        t('permissions.forbidden_toast', {
          defaultValue: 'Нет доступа к этому разделу',
        }),
      )
    }
  }, [isLoaded, allowed, t])

  if (isLoaded && !allowed) {
    return <Navigate to={`/${salonId}/dashboard`} replace />
  }
  return <>{children}</>
}
