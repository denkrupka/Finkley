import { format } from 'date-fns'
import { Archive, ArrowDown, ArrowUp, Pencil, ShoppingCart, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { getDateLocale } from '@/lib/utils/format-date'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  useApplyInventoryTx,
  useInventoryTransactions,
  useMaterialUsage,
  useUpdateInventoryItem,
  type InventoryItemRow,
  type InventoryTransactionRow,
  type InventoryTxType,
} from '@/hooks/useInventory'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

import { InventoryItemFormDialog } from './InventoryItemFormDialog'
import { InventoryTxDialog } from './InventoryTxDialog'

type Props = {
  open: boolean
  item: InventoryItemRow | null
  onClose: () => void
  salonId: string
  currency: string
  canEdit: boolean
}

const TX_LABEL: Record<
  InventoryTxType,
  { label_key: string; tone: 'sage' | 'red' | 'navy' | 'amber' }
> = {
  purchase: { label_key: 'inventory.tx.purchase', tone: 'sage' },
  consumption: { label_key: 'inventory.tx.consumption', tone: 'navy' },
  manual_adjustment: { label_key: 'inventory.tx.manual_adjustment', tone: 'amber' },
  stocktake: { label_key: 'inventory.tx.stocktake', tone: 'navy' },
  waste: { label_key: 'inventory.tx.waste', tone: 'red' },
}

export function InventoryItemDrawer({ open, item, onClose, salonId, currency, canEdit }: Props) {
  const { t } = useTranslation()
  const update = useUpdateInventoryItem(salonId)
  const apply = useApplyInventoryTx(salonId)
  const { data: usage = [] } = useMaterialUsage(item?.id)
  const { data: transactions = [] } = useInventoryTransactions(item?.id, 30)

  const [editOpen, setEditOpen] = useState(false)
  const [txDialog, setTxDialog] = useState<{
    type: 'purchase' | 'manual_adjustment' | 'waste'
  } | null>(null)

  if (!item) return null
  const itemSafe = item // narrowed reference для closure'ов внутри JSX/функций

  const isLow = itemSafe.current_stock <= itemSafe.min_stock && itemSafe.current_stock > 0
  const isOut = itemSafe.current_stock <= 0
  const value = itemSafe.current_stock * itemSafe.cost_per_unit_cents

  // Прогноз: средний расход за последние 30 дней (consumption-транзакции, abs)
  const consumptionLast30 = transactions
    .filter((tx) => tx.type === 'consumption')
    .filter((tx) => {
      const d = new Date(tx.created_at)
      return d.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
    })
    .reduce((sum, tx) => sum + Math.abs(tx.quantity), 0)
  const dailyAvg = consumptionLast30 / 30
  const daysLeft = dailyAvg > 0 ? Math.floor(item.current_stock / dailyAvg) : null

  function archive() {
    if (!confirm(t('inventory.confirm_archive'))) return
    update.mutate(
      { id: itemSafe.id, is_archived: true },
      {
        onSuccess: () => {
          toast.success(t('inventory.toast_archived'))
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{item.name}</SheetTitle>
          <SheetDescription>
            {item.category ? `${item.category} · ` : ''}
            {item.unit}
            {item.sku ? ` · ${item.sku}` : ''}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="px-5 py-5">
          <div className="flex flex-col gap-5">
            {/* Stock card */}
            <section className="border-border bg-muted/30 rounded-md border p-4">
              <p className="text-muted-foreground text-xs font-semibold uppercase">
                {t('inventory.drawer.current_stock')}
              </p>
              <p
                className={cn(
                  'num mt-1 text-3xl font-bold tracking-tight',
                  isOut ? 'text-destructive' : isLow ? 'text-amber-700' : 'text-foreground',
                )}
              >
                {item.current_stock} <span className="text-base font-medium">{item.unit}</span>
              </p>
              <div className="text-muted-foreground mt-2 grid grid-cols-2 gap-1 text-xs">
                <span>
                  {t('inventory.drawer.min_stock')}: <span className="num">{item.min_stock}</span>
                </span>
                <span>
                  {t('inventory.drawer.value')}:{' '}
                  <span className="num">{value > 0 ? formatCurrency(value, currency) : '—'}</span>
                </span>
                <span>
                  {t('inventory.drawer.cost_per_unit')}:{' '}
                  <span className="num">
                    {item.cost_per_unit_cents > 0
                      ? formatCurrency(item.cost_per_unit_cents, currency)
                      : '—'}
                  </span>
                </span>
                {daysLeft !== null ? (
                  <span>
                    {t('inventory.drawer.days_left')}:{' '}
                    <span
                      className={cn(
                        'num font-bold',
                        daysLeft < 7 ? 'text-destructive' : daysLeft < 14 ? 'text-amber-700' : '',
                      )}
                    >
                      ~{daysLeft}д
                    </span>
                  </span>
                ) : null}
              </div>
            </section>

            {/* Action buttons */}
            {canEdit ? (
              <div className="grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setTxDialog({ type: 'purchase' })}
                >
                  <ShoppingCart className="size-4" strokeWidth={2} />
                  {t('inventory.drawer.purchase')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTxDialog({ type: 'manual_adjustment' })}
                >
                  <Sparkles className="size-4" strokeWidth={2} />
                  {t('inventory.drawer.adjust')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setTxDialog({ type: 'waste' })}>
                  <Trash2 className="size-4" strokeWidth={2} />
                  {t('inventory.drawer.waste')}
                </Button>
              </div>
            ) : null}

            {/* Used in services */}
            <section>
              <h3 className="text-foreground mb-2 text-sm font-bold">
                {t('inventory.drawer.used_in')}
              </h3>
              {usage.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t('inventory.drawer.used_in_empty')}
                </p>
              ) : (
                <ul className="border-border bg-card divide-border divide-y rounded-md border">
                  {usage.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="text-foreground truncate">{u.service?.name ?? '—'}</span>
                      <span className="num text-muted-foreground shrink-0 text-xs">
                        {u.quantity} {item.unit} {t('inventory.drawer.per_visit')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to={`/${salonId}/services`}
                className="text-secondary mt-2 inline-block text-xs font-semibold hover:underline"
              >
                {t('inventory.drawer.manage_recipes')} →
              </Link>
            </section>

            {/* Transactions log */}
            <section>
              <h3 className="text-foreground mb-2 text-sm font-bold">
                {t('inventory.drawer.history')}
              </h3>
              {transactions.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t('inventory.drawer.history_empty')}
                </p>
              ) : (
                <ul className="border-border bg-card divide-border divide-y rounded-md border">
                  {transactions.map((tx) => (
                    <TxRow key={tx.id} tx={tx} unit={item.unit} currency={currency} />
                  ))}
                </ul>
              )}
            </section>

            {/* Notes */}
            {item.notes ? (
              <section>
                <h3 className="text-foreground mb-1.5 text-sm font-bold">
                  {t('inventory.drawer.notes')}
                </h3>
                <p className="text-foreground/80 whitespace-pre-wrap text-xs">{item.notes}</p>
              </section>
            ) : null}
          </div>
        </SheetBody>

        {canEdit ? (
          <SheetFooter>
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" strokeWidth={2} />
                {t('common.edit')}
              </Button>
              <Button
                variant="outline"
                className="text-muted-foreground hover:text-destructive"
                onClick={archive}
              >
                <Archive className="size-4" strokeWidth={2} />
              </Button>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>

      <InventoryItemFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        salonId={salonId}
        currency={currency}
        item={item}
      />

      <InventoryTxDialog
        open={!!txDialog}
        type={txDialog?.type ?? 'purchase'}
        onClose={() => setTxDialog(null)}
        salonId={salonId}
        item={item}
        currency={currency}
        applyMutation={apply}
      />
    </Sheet>
  )
}

function TxRow({
  tx,
  unit,
  currency,
}: {
  tx: InventoryTransactionRow
  unit: string
  currency: string
}) {
  const { t } = useTranslation()
  const meta = TX_LABEL[tx.type]
  const isPositive = tx.quantity > 0
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
          {isPositive ? (
            <ArrowUp className="text-brand-sage size-3" strokeWidth={2.4} />
          ) : (
            <ArrowDown className="text-destructive size-3" strokeWidth={2.4} />
          )}
          {t(meta.label_key)}
        </span>
        <span className="text-muted-foreground text-[11px]">
          {format(new Date(tx.created_at), 'd MMM HH:mm', { locale: getDateLocale() })}
          {tx.notes ? ` · ${tx.notes}` : ''}
        </span>
      </div>
      <div className="text-right">
        <span
          className={cn(
            'num text-sm font-bold',
            isPositive ? 'text-brand-sage' : 'text-destructive',
          )}
        >
          {isPositive ? '+' : ''}
          {tx.quantity} {unit}
        </span>
        {tx.cost_cents ? (
          <span className="num text-muted-foreground block text-[11px]">
            {formatCurrency(tx.cost_cents, currency)}
          </span>
        ) : null}
      </div>
    </li>
  )
}
