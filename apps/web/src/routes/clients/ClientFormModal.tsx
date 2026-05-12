import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
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
import { useCreateClient, useUpdateClient, type ClientRow } from '@/hooks/useClients'
import { toE164 } from '@/lib/utils/format-phone'

type FormValues = {
  name: string
  phone: string
  email: string
  source: string
  notes: string
}

const schema = z.object({
  name: z.string().min(1, 'clients.errors.name_required').max(120),
  phone: z.string().max(40).optional().default(''),
  email: z
    .string()
    .max(120)
    .optional()
    .default('')
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'clients.errors.email_invalid'),
  source: z.string().max(120).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  /** Если передан — режим редактирования */
  client?: ClientRow | null
  /** Префил поля «Имя» при создании (например, из ClientPicker query). */
  prefillName?: string
  /** Колбек после успешного создания — для ClientPicker, чтобы выбрать клиента. */
  onCreated?: (client: ClientRow) => void
}

export function ClientFormModal({
  open,
  onOpenChange,
  salonId,
  client,
  prefillName,
  onCreated,
}: Props) {
  const { t } = useTranslation()
  const create = useCreateClient(salonId)
  const update = useUpdateClient(salonId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', phone: '', email: '', source: '', notes: '' },
  })

  useEffect(() => {
    if (!open) return
    // prefillName используется только при создании (когда client пустой) —
    // например, ClientPicker подкидывает введённый query.
    const looksLikePhone =
      !!prefillName &&
      /^[\d+\s()-]+$/.test(prefillName) &&
      prefillName.replace(/[^\d]/g, '').length >= 7
    form.reset({
      name: client?.name ?? (looksLikePhone ? '' : (prefillName ?? '')),
      phone: client?.phone ?? (looksLikePhone ? prefillName! : ''),
      email: client?.email ?? '',
      source: client?.source ?? '',
      notes: client?.notes ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый ресет на open
  }, [open, client?.id, prefillName])

  const isEdit = !!client
  const pending = create.isPending || update.isPending

  function onSubmit(values: FormValues) {
    // Если телефон ввели — нормализуем в E.164. Если ввод невалидный —
    // сохраняем raw + предупреждаем (но не блокируем — может быть нестандартный формат).
    const phoneRaw = values.phone.trim()
    const phoneE164 = phoneRaw ? toE164(phoneRaw) : null
    const phoneToSave = phoneE164 ?? (phoneRaw || null)

    const payload = {
      name: values.name,
      phone: phoneToSave,
      email: values.email || null,
      source: values.source || null,
      notes: values.notes || null,
    }

    const onError = (err: unknown) => {
      toast.error(t('clients.toast_error'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }

    if (isEdit && client) {
      update.mutate(
        { id: client.id, ...payload },
        {
          onSuccess: () => {
            toast.success(t('clients.toast_updated'))
            onOpenChange(false)
          },
          onError,
        },
      )
    } else {
      create.mutate(
        { salon_id: salonId, ...payload },
        {
          onSuccess: (created) => {
            toast.success(t('clients.toast_created'))
            onCreated?.(created)
            onOpenChange(false)
          },
          onError,
        },
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('clients.form.title_edit') : t('clients.form.title_new')}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 px-5 pb-2 pt-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-name">{t('clients.form.name_label')}</Label>
            <Input
              id="cl-name"
              autoFocus
              placeholder={t('clients.form.name_placeholder')}
              data-testid="cl-name"
              {...form.register('name')}
              aria-invalid={!!form.formState.errors.name}
            />
            {form.formState.errors.name ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.name.message ?? '')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-phone">{t('clients.form.phone_label')}</Label>
            <Input
              id="cl-phone"
              type="tel"
              inputMode="tel"
              placeholder="+48 600 12 34 56"
              {...form.register('phone')}
            />
            <p className="text-muted-foreground text-xs">{t('clients.form.phone_hint')}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-email">{t('clients.form.email_label')}</Label>
            <Input
              id="cl-email"
              type="email"
              inputMode="email"
              placeholder="anna@example.com"
              {...form.register('email')}
              aria-invalid={!!form.formState.errors.email}
            />
            {form.formState.errors.email ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.email.message ?? '')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-source">{t('clients.form.source_label')}</Label>
            <Input
              id="cl-source"
              placeholder={t('clients.form.source_placeholder')}
              {...form.register('source')}
              list="cl-source-suggestions"
            />
            {/* Подсказки самых распространённых источников; юзер может писать своё. */}
            <datalist id="cl-source-suggestions">
              <option value="Instagram" />
              <option value="Booksy" />
              <option value="Google Maps" />
              <option value="Рекомендация" />
              <option value="Реклама" />
              <option value="Прохожий" />
            </datalist>
            <p className="text-muted-foreground text-xs">{t('clients.form.source_hint')}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-notes">{t('clients.form.notes_label')}</Label>
            <Input
              id="cl-notes"
              placeholder={t('clients.form.notes_placeholder')}
              {...form.register('notes')}
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={form.handleSubmit(onSubmit)}
            disabled={pending}
            data-testid="cl-submit"
          >
            {pending
              ? t('common.loading')
              : isEdit
                ? t('clients.form.submit_edit')
                : t('clients.form.submit_new')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
