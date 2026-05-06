import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
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
import {
  useCreateExpense,
  useExpenseCategories,
  type ExpenseCategoryRow,
} from '@/hooks/useExpenses'
import type { PaymentMethod } from '@/hooks/useVisits'

const PAYMENT_OPTIONS: PaymentMethod[] = ['cash', 'card', 'transfer']

type FormValues = {
  expense_at: string
  category_id: string
  amount: string
  payment_method: PaymentMethod | ''
  comment: string
}

const schema = z.object({
  expense_at: z.string().min(1),
  category_id: z.string().min(1, 'expenses.errors.category_required'),
  amount: z
    .string()
    .min(1, 'expenses.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'expenses.errors.amount_positive'),
  payment_method: z.enum(['cash', 'card', 'transfer', '']).optional().default(''),
  comment: z.string().max(500).optional().default(''),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  /** Если передано — преселектируем эту категорию */
  defaultCategoryId?: string | null
}

export function ExpenseFormModal({
  open,
  onOpenChange,
  salonId,
  currency,
  defaultCategoryId,
}: Props) {
  const { t } = useTranslation()
  const { data: categories = [] } = useExpenseCategories(salonId)
  const createExpense = useCreateExpense(salonId)

  const today = format(new Date(), 'yyyy-MM-dd')

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      expense_at: today,
      category_id: defaultCategoryId ?? '',
      amount: '',
      payment_method: '',
      comment: '',
    },
  })

  function onSubmit(values: FormValues) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)
    createExpense.mutate(
      {
        salon_id: salonId,
        expense_at: values.expense_at,
        category_id: values.category_id || null,
        amount_cents: amountCents,
        payment_method: values.payment_method || null,
        comment: values.comment || null,
      },
      {
        onSuccess: () => {
          toast.success(t('expenses.toast_added'))
          form.reset({
            expense_at: today,
            category_id: defaultCategoryId ?? '',
            amount: '',
            payment_method: '',
            comment: '',
          })
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error(t('expenses.toast_error'), {
            description: err instanceof Error ? err.message : String(err),
          })
        },
      },
    )
  }

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('expenses.form.title_new')}</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 px-5 pb-2 pt-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-date">{t('expenses.form.date_label')}</Label>
            <Input id="exp-date" type="date" {...form.register('expense_at')} />
          </div>

          <Controller
            name="category_id"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exp-cat">{t('expenses.form.category_label')}</Label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="exp-cat" data-testid="exp-cat">
                    <SelectValue placeholder={t('expenses.form.category_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c: ExpenseCategoryRow) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.category_id ? (
                  <p className="text-destructive text-xs font-medium" role="alert">
                    {t(form.formState.errors.category_id.message ?? '')}
                  </p>
                ) : null}
              </div>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-amount">{t('expenses.form.amount_label')}</Label>
            <div className="border-brand-yellow-deep bg-brand-yellow flex h-16 items-center gap-2 rounded-md border-[1.5px] px-4">
              <span className="num text-brand-navy text-3xl font-bold">{currencySymbol}</span>
              <input
                id="exp-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0"
                {...form.register('amount')}
                className="num text-brand-navy placeholder:text-brand-navy/30 h-full flex-1 bg-transparent text-3xl font-bold tracking-tight outline-none"
                data-testid="exp-amount"
              />
            </div>
            {form.formState.errors.amount ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.amount.message ?? '')}
              </p>
            ) : null}
          </div>

          <Controller
            name="payment_method"
            control={form.control}
            render={({ field }) => (
              <div className="flex gap-2">
                {PAYMENT_OPTIONS.map((p) => {
                  const active = field.value === p
                  return (
                    <button
                      type="button"
                      key={p}
                      onClick={() => field.onChange(active ? '' : p)}
                      className={`flex h-10 flex-1 items-center justify-center rounded-full border-[1.5px] text-sm font-semibold transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:bg-accent/50'
                      }`}
                    >
                      {t(`payment_methods.${p}`)}
                    </button>
                  )
                })}
              </div>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-comment">{t('expenses.form.comment_label')}</Label>
            <Input
              id="exp-comment"
              placeholder={t('expenses.form.comment_placeholder')}
              {...form.register('comment')}
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createExpense.isPending}
            data-testid="exp-submit"
          >
            {createExpense.isPending ? t('common.loading') : t('expenses.form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
