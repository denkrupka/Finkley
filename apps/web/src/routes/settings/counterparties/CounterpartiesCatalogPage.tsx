import { ArrowLeft, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useArchiveCounterparty,
  useCounterparties,
  useCounterpartyCategories,
  type CounterpartyRow,
} from '@/hooks/useCounterparties'
import { cn } from '@/lib/utils/cn'

import { CounterpartyEditModal } from './CounterpartyEditModal'

/**
 * Settings → Справочники → Контрагенты. CRUD-страница для управления
 * списком поставщиков/контрагентов: поиск, добавление, редактирование,
 * архивирование. Создание контрагента поддерживает поиск по NIP через
 * Data PORT — экономит ручной ввод.
 */
export function CounterpartiesCatalogPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: counterparties = [], isLoading } = useCounterparties(salonId)
  const { data: categories = [] } = useCounterpartyCategories(salonId)
  const archive = useArchiveCounterparty(salonId)

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CounterpartyRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return counterparties
    return counterparties.filter((cp) => {
      return (
        cp.name.toLowerCase().includes(q) ||
        (cp.nip?.toLowerCase().includes(q) ?? false) ||
        (cp.address?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [counterparties, search])

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-4">
        <Link
          to={`/${salonId}/settings?tab=catalogs`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.7} />
          {t('counterparties.back_to_catalogs')}
        </Link>
      </div>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('counterparties.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('counterparties.subtitle')}</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" strokeWidth={2.4} />
          {t('counterparties.add')}
        </Button>
      </div>

      <div className="mb-3">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
            strokeWidth={1.7}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('counterparties.search_placeholder')}
            className="pl-10"
          />
        </div>
      </div>

      <div className="border-border bg-card shadow-finsm rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            {search ? t('counterparties.empty_search') : t('counterparties.empty')}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('counterparties.col_name')}
                </th>
                <th className="px-3 py-3 text-left font-semibold">{t('counterparties.col_nip')}</th>
                <th className="px-3 py-3 text-left font-semibold">
                  {t('counterparties.col_address')}
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  {t('counterparties.col_category')}
                </th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((cp) => (
                <tr
                  key={cp.id}
                  className={cn(
                    'border-border/60 hover:bg-muted/20 cursor-pointer border-t',
                    cp.archived_at && 'opacity-50',
                  )}
                  onClick={() => setEditing(cp)}
                >
                  <td className="text-foreground px-4 py-2.5 text-sm font-semibold">{cp.name}</td>
                  <td className="num text-muted-foreground px-3 py-2.5 text-xs">{cp.nip ?? '—'}</td>
                  <td className="text-muted-foreground px-3 py-2.5 text-xs">{cp.address ?? '—'}</td>
                  <td className="text-muted-foreground px-3 py-2.5 text-xs">
                    {cp.category_id ? (categoryById.get(cp.category_id) ?? '—') : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!window.confirm(t('counterparties.confirm_archive'))) return
                        archive.mutate(cp.id, {
                          onSuccess: () => toast.success(t('counterparties.toast_archived')),
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : String(err)),
                        })
                      }}
                      className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                      aria-label={t('common.delete')}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.8} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CounterpartyEditModal
        open={createOpen || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false)
            setEditing(null)
          }
        }}
        salonId={salonId}
        counterparty={editing}
      />
    </div>
  )
}
