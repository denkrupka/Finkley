import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateSalon } from '@/hooks/useSalonMutations'
import type { SalonRow } from '@/hooks/useSalons'

type Props = { salon: SalonRow }

/**
 * Настройки сегментации клиентов на уровне салона:
 *   - retention_window_days — после скольки дней без визита клиент
 *     становится «давно не был» (lapsed) вместо «постоянного»
 *   - churn_window_days — после скольки дней клиент = «ушёл» (churned)
 *
 * Окна используются:
 *   - на /clients — для RFM-сегментации и фильтра «давно не были»
 *   - на /staff → KPI ретеншна (если у мастера нет своего значения)
 */
export function SegmentationCard({ salon }: Props) {
  const { t } = useTranslation()
  const update = useUpdateSalon()
  const [retention, setRetention] = useState(String(salon.retention_window_days))
  const [churn, setChurn] = useState(String(salon.churn_window_days))

  useEffect(() => {
    setRetention(String(salon.retention_window_days))
    setChurn(String(salon.churn_window_days))
  }, [salon.retention_window_days, salon.churn_window_days])

  function save() {
    const r = parseInt(retention, 10)
    const c = parseInt(churn, 10)
    if (Number.isNaN(r) || r < 7 || r > 365) {
      toast.error(t('settings.segmentation.retention_invalid'))
      return
    }
    if (Number.isNaN(c) || c < 30 || c > 730) {
      toast.error(t('settings.segmentation.churn_invalid'))
      return
    }
    if (c <= r) {
      toast.error(t('settings.segmentation.churn_must_exceed_retention'))
      return
    }
    update.mutate(
      { id: salon.id, retention_window_days: r, churn_window_days: c },
      {
        onSuccess: () => toast.success(t('settings.toast_saved')),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
      <h2 className="text-brand-navy text-base font-bold tracking-tight">
        {t('settings.segmentation.title')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">{t('settings.segmentation.subtitle')}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="seg-retention">{t('settings.segmentation.retention_label')}</Label>
          <div className="border-border bg-card flex h-11 items-center rounded-md border px-3">
            <Input
              id="seg-retention"
              type="number"
              min={7}
              max={365}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              className="num h-full border-0 px-0 text-base font-bold focus-visible:ring-0"
            />
            <span className="num text-muted-foreground text-sm">
              {t('settings.segmentation.days')}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            {t('settings.segmentation.retention_hint')}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="seg-churn">{t('settings.segmentation.churn_label')}</Label>
          <div className="border-border bg-card flex h-11 items-center rounded-md border px-3">
            <Input
              id="seg-churn"
              type="number"
              min={30}
              max={730}
              value={churn}
              onChange={(e) => setChurn(e.target.value)}
              className="num h-full border-0 px-0 text-base font-bold focus-visible:ring-0"
            />
            <span className="num text-muted-foreground text-sm">
              {t('settings.segmentation.days')}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">{t('settings.segmentation.churn_hint')}</p>
        </div>
      </div>

      <Button className="mt-4" size="md" onClick={save} disabled={update.isPending}>
        {t('common.save')}
      </Button>
    </section>
  )
}
