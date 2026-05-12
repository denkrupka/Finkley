import { zodResolver } from '@hookform/resolvers/zod'
import { differenceInDays, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useExpenseCategories } from '@/hooks/useExpenses'
import {
  useCreateScheduledPayment,
  useDeleteScheduledPayment,
  useMarkPaymentPaid,
  useScheduledPayments,
} from '@/hooks/useScheduledPayments'
import { useSalon } from '@/hooks/useSalons'
import { formatCurrency } from '@/lib/utils/format-currency'

type FormValues = {
  due_date: string
  vendor_name: string
  invoice_number: string
  amount: string
  category_id: string
  comment: string
}

const schema = z.object({
  due_date: z.string().min(1),
  vendor_name: z.string().min(1, 'finance.payments_form.errors.vendor_required'),
  invoice_number: z.string().max(100).optional().default(''),
  amount: z
    .string()
    .min(1, 'finance.payments_form.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'finance.payments_form.errors.amount_positive'),
  category_id: z.string().optional().default(''),
  comment: z.string().max(500).optional().default(''),
})

/**
 * Контент таба «Счета на оплату» страницы /finance. Список запланированных
 * платежей с возможностью пометить как «оплачено» (опционально создавая
 * связанную expense-запись).
 *
 * MVP: только manual-источник (юзер вручную вводит счёт). Auto-import из
 * wFirma/Fakturownia при sync — отдельный спринт.
 */
export function PaymentsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const { data: payments = [], isLoading } = useScheduledPayments(salonId)
  const { data: categories = [] } = useExpenseCategories(salonId)
  const createPmt = useCreateScheduledPayment(salonId)
  const markPaid = useMarkPaymentPaid(salonId)
  const deletePmt = useDeleteScheduledPayment(salonId)

  const [formOpen, setFormOpen] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const pending = payments.filter((p) => p.status === 'pending')
  const overdue = pending.filter((p) => p.due_date < today)
  const upcoming = pending.filter((p) => p.due_date >= today)
  const paid = payments.filter((p) => p.status === 'paid')

  const totalUpcoming = upcoming.reduce((s, p) => s + p.amount_cents, 0)
  const totalOverdue = overdue.reduce((s, p) => s + p.amount_cents, 0)

  return (
    <div>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('finance.payments.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('finance.payments.subtitle')}</p>
        </div>
        <Button variant="secondary" size="md" onClick={() => setFormOpen(true)}>
          <Plus className="size-4" strokeWidth={2.4} />
          {t('finance.payments.add_button')}
        </Button>
      </div>

      {/* Summary */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="border-destructive/40 bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.payments.summary_overdue')}
          </p>
          <p className="num text-destructive mt-1 text-2xl font-bold">
            {formatCurrency(totalOverdue, currency)}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('finance.payments.summary_overdue_count', { count: overdue.length })}
          </p>
        </div>
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.payments.summary_upcoming')}
          </p>
          <p className="num text-foreground mt-1 text-2xl font-bold">
            {formatCurrency(totalUpcoming, currency)}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('finance.payments.summary_upcoming_count', { count: upcoming.length })}
          </p>
        </div>
      </div>

      {/* Lists */}
      <div className="border-border bg-card shadow-finsm rounded-lg border">
        {isLoading ? (
          <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
        ) : payments.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">{t('finance.payments.empty')}</div>
        ) : (
          <ul className="divide-border divide-y">
            {[...overdue, ...upcoming, ...paid].map((p) => {
              const days = differenceInDays(new Date(p.due_date), new Date(today))
              const isPaid = p.status === 'paid'
              const isOverdue = !isPaid && days < 0
              return (
                <li
                  key={p.id}
                  className="grid grid-cols-[92px_1fr_auto_auto] items-center gap-3 px-4 py-3"
                >
                  <span className="flex flex-col">
                    <span
                      className={`num text-xs ${
                        isPaid
                          ? 'text-muted-foreground line-through'
                          : isOverdue
                            ? 'text-destructive font-semibold'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {format(new Date(p.due_date), 'd MMM yyyy', { locale: ru })}
                    </span>
                    {!isPaid ? (
                      <span
                        className={`mt-0.5 text-[11px] ${
                          isOverdue ? 'text-destructive' : 'text-muted-foreground'
                        }`}
                      >
                        {isOverdue
                          ? t('finance.payments.days_overdue', { n: -days })
                          : days === 0
                            ? t('finance.payments.today')
                            : t('finance.payments.in_days', { n: days })}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-col">
                    <span
                      className={`text-sm font-semibold ${
                        isPaid ? 'text-muted-foreground line-through' : 'text-foreground'
                      }`}
                    >
                      {p.vendor_name ?? '—'}
                    </span>
                    {p.invoice_number || p.comment ? (
                      <span className="text-brand-text-faint mt-0.5 line-clamp-1 text-[11px]">
                        {[p.invoice_number, p.comment].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`num text-right text-sm font-bold ${
                      isPaid ? 'text-muted-foreground line-through' : 'text-foreground'
                    }`}
                  >
                    {formatCurrency(p.amount_cents, currency)}
                  </span>
                  <span className="flex items-center gap-0.5">
                    {!isPaid ? (
                      <button
                        type="button"
                        onClick={() => {
                          const createExpense = confirm(t('finance.payments.confirm_mark_paid'))
                          markPaid.mutate(
                            { id: p.id, createExpense },
                            {
                              onSuccess: () => toast.success(t('finance.payments.toast_paid')),
                            },
                          )
                        }}
                        className="text-brand-sage-deep grid size-8 place-items-center rounded-md hover:bg-emerald-50"
                        aria-label={t('finance.payments.mark_paid')}
                        title={t('finance.payments.mark_paid')}
                      >
                        <CheckCircle2 className="size-5" strokeWidth={1.8} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(t('finance.payments.confirm_delete'))) return
                        deletePmt.mutate(p.id, {
                          onSuccess: () => toast.success(t('finance.payments.toast_deleted')),
                        })
                      }}
                      className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                      aria-label="delete"
                    >
                      <Trash2 className="size-4" strokeWidth={1.7} />
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <PaymentFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        salonId={salonId}
        currency={currency}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        onCreate={(input) =>
          createPmt.mutate(input, {
            onSuccess: () => {
              toast.success(t('finance.payments.toast_added'))
              setFormOpen(false)
            },
            onError: (err) =>
              toast.error(t('finance.payments.toast_error'), {
                description: err instanceof Error ? err.message : String(err),
              }),
          })
        }
        isPending={createPmt.isPending}
      />
    </div>
  )
}

function PaymentFormModal({
  open,
  onOpenChange,
  salonId,
  currency,
  categories,
  onCreate,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  categories: { id: string; name: string }[]
  onCreate: (input: {
    salon_id: string
    due_date: string
    amount_cents: number
    vendor_name: string | null
    invoice_number: string | null
    category_id: string | null
    comment: string | null
  }) => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  const today = format(new Date(), 'yyyy-MM-dd')

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      due_date: today,
      vendor_name: '',
      invoice_number: '',
      amount: '',
      category_id: '',
      comment: '',
    },
  })

  function onSubmit(values: FormValues) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)
    onCreate({
      salon_id: salonId,
      due_date: values.due_date,
      amount_cents: amountCents,
      vendor_name: values.vendor_name || null,
      invoice_number: values.invoice_number || null,
      category_id: values.category_id || null,
      comment: values.comment || null,
    })
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.payments_form.title')}</DialogTitle>
        </DialogHeader>

        <form className="flex flex-col gap-4 px-5 pb-2 pt-2" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pmt-due">{t('finance.payments_form.due_date')}</Label>
            <Input id="pmt-due" type="date" {...form.register('due_date')} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pmt-vendor">{t('finance.payments_form.vendor')}</Label>
            <Input
              id="pmt-vendor"
              placeholder={t('finance.payments_form.vendor_placeholder')}
              {...form.register('vendor_name')}
            />
            {form.formState.errors.vendor_name ? (
              <p className="text-destructive text-xs">
                {t(form.formState.errors.vendor_name.message ?? '')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pmt-invoice">{t('finance.payments_form.invoice_number')}</Label>
            <Input
              id="pmt-invoice"
              placeholder={t('finance.payments_form.invoice_placeholder')}
              {...form.register('invoice_number')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pmt-amount">
              {t('finance.payments_form.amount')} ({currency})
            </Label>
            <Input
              id="pmt-amount"
              inputMode="decimal"
              placeholder="0.00"
              {...form.register('amount')}
            />
            {form.formState.errors.amount ? (
              <p className="text-destructive text-xs">
                {t(form.formState.errors.amount.message ?? '')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pmt-cat">{t('finance.payments_form.category')}</Label>
            <Controller
              name="category_id"
              control={form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="pmt-cat">
                    <SelectValue placeholder={t('finance.payments_form.category_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pmt-comment">{t('finance.payments_form.comment')}</Label>
            <Input id="pmt-comment" {...form.register('comment')} />
          </div>

          <DialogFooter className="px-0">
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
