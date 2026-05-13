import { useTranslation } from 'react-i18next'

import { useAdminSalons } from '@/hooks/useAdmin'

export function AdminSalonsPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminSalons()

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'load_failed'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col p-5 sm:p-8">
      <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">{t('admin.salons.name')}</th>
              <th className="px-4 py-3 text-left">{t('admin.salons.owner')}</th>
              <th className="px-4 py-3 text-left">{t('admin.salons.currency')}</th>
              <th className="px-4 py-3 text-left">{t('admin.salons.plan')}</th>
              <th className="px-4 py-3 text-left">{t('admin.salons.created')}</th>
            </tr>
          </thead>
          <tbody>
            {data.salons.map((s) => (
              <tr key={s.id} className="border-border border-t">
                <td className="px-4 py-3 font-semibold">{s.name}</td>
                <td className="text-muted-foreground px-4 py-3">{s.owner_email ?? '—'}</td>
                <td className="px-4 py-3">{s.currency}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      s.plan_status === 'active' || s.plan_status === 'trialing'
                        ? 'inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700'
                        : 'inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600'
                    }
                  >
                    {s.plan_status ?? 'none'}
                  </span>
                </td>
                <td className="text-muted-foreground px-4 py-3 text-xs">
                  {new Date(s.created_at).toLocaleDateString('ru-RU')}
                </td>
              </tr>
            ))}
            {data.salons.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                  {t('admin.salons.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
