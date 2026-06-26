import { useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSalonIntegrations } from '@/hooks/useIntegrations'

const PROVIDER_LABEL: Record<string, string> = {
  booksy: 'Booksy',
  fresha: 'Fresha',
  treatwell: 'Treatwell',
  yclients: 'YClients',
  bookon: 'Bookon',
  wfirma: 'wFirma',
  fakturownia: 'Fakturownia',
  infakt: 'inFakt',
  ksef: 'KSeF',
}

/**
 * Push-only интеграции (бухгалтерия): мы ВЫГРУЖАЕМ в них расходы как фактуры,
 * но НИЧЕГО не подтягиваем обратно. У них `last_sync_at` всегда остаётся NULL,
 * поэтому в плашку «подтягиваем данные» им не место — иначе она висит вечно и
 * вводит в заблуждение (мол, что-то тянем из wFirma, хотя поток только наружу).
 * Плашка — только для провайдеров, которые реально импортируют данные в Finkley
 * (системы бронирования).
 */
const PUSH_ONLY_PROVIDERS = new Set(['wfirma', 'fakturownia', 'infakt', 'ksef'])

/**
 * Плашка статуса первичной загрузки данных (задача 10).
 *
 * После онбординга интеграции подключены, но импорт (Booksy/бухгалтерия)
 * идёт в фоне минуты. Пока у подключённой интеграции `last_sync_at IS NULL`
 * — данные ещё не подтянулись, и цифры на дашборде/в отчётах могут быть
 * неполными. Показываем тёплую (не тревожную) плашку с предупреждением и
 * сами опрашиваем статус — как только импорт прошёл хотя бы раз, плашка
 * исчезает.
 *
 * Сознательно НЕ блокирующая страница загрузки: если синк зависнет/упадёт,
 * блокирующий экран «застрял бы навсегда» и напугал бы клиента. Плашка же
 * не мешает работать и закрывается крестиком.
 */
export function SyncStatusBanner({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const [dismissed, setDismissed] = useState(false)

  const syncing = integrations.filter(
    (i) => i.status === 'connected' && !i.last_sync_at && !PUSH_ONLY_PROVIDERS.has(i.provider),
  )
  const syncingCount = syncing.length

  // Пока идёт первичная загрузка — опрашиваем статус, чтобы плашка сама
  // исчезла, как только last_sync_at проставится.
  useEffect(() => {
    if (syncingCount === 0) return
    const id = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    }, 12_000)
    return () => window.clearInterval(id)
  }, [syncingCount, salonId, qc])

  if (dismissed || syncingCount === 0) return null

  const names = syncing.map((i) => PROVIDER_LABEL[i.provider] ?? i.provider).join(', ')

  return (
    <div
      role="status"
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
    >
      <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2.2} />
      <p className="min-w-0 flex-1">
        {t('sync_banner.text', {
          providers: names,
          defaultValue:
            'Подтягиваем данные из {{providers}} — это может занять несколько минут. Пока цифры могут показываться не полностью.',
        })}
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('common.close', { defaultValue: 'Закрыть' })}
        className="-mr-1 grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-amber-100 dark:hover:bg-amber-400/20"
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}
