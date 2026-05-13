import { useTranslation } from 'react-i18next'

import { useAdminUsers } from '@/hooks/useAdmin'

export function AdminUsersPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminUsers()

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
              <th className="px-4 py-3 text-left">{t('admin.users.email')}</th>
              <th className="px-4 py-3 text-left">{t('admin.users.last_signin')}</th>
              <th className="px-4 py-3 text-left">{t('admin.users.created')}</th>
              <th className="px-4 py-3 text-left">{t('admin.users.salons')}</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-border border-t">
                <td className="px-4 py-3 font-semibold">{u.email ?? '—'}</td>
                <td className="text-muted-foreground px-4 py-3 text-xs">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('ru-RU') : '—'}
                </td>
                <td className="text-muted-foreground px-4 py-3 text-xs">
                  {new Date(u.created_at).toLocaleDateString('ru-RU')}
                </td>
                <td className="px-4 py-3">{u.salons_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
