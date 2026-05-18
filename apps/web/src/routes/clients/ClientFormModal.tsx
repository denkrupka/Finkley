import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Facebook, Instagram, Plus, Send, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
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
  useClients,
  useCreateClient,
  useUpdateClient,
  type ClientRow,
  type ClientSocial,
} from '@/hooks/useClients'
import { toE164 } from '@/lib/utils/format-phone'

const COUNTRY_OPTIONS: {
  code: 'PL' | 'UA' | 'RU' | 'DE' | 'GB' | 'CZ' | 'OTHER'
  dial: string
  label: string
}[] = [
  { code: 'PL', dial: '+48', label: 'Polska' },
  { code: 'UA', dial: '+380', label: 'Україна' },
  { code: 'RU', dial: '+7', label: 'Россия' },
  { code: 'DE', dial: '+49', label: 'Deutschland' },
  { code: 'GB', dial: '+44', label: 'United Kingdom' },
  { code: 'CZ', dial: '+420', label: 'Česko' },
  { code: 'OTHER', dial: '+', label: '…' },
]

type SocialKind = 'instagram' | 'facebook' | 'telegram' | 'custom'

type FormValues = {
  name: string
  countryCode: (typeof COUNTRY_OPTIONS)[number]['code']
  phoneLocal: string
  email: string
  source: string
  notes: string
  socials: { kind: SocialKind; label?: string; handle: string }[]
}

const schema = z.object({
  name: z.string().min(1, 'clients.errors.name_required').max(120),
  countryCode: z.enum(['PL', 'UA', 'RU', 'DE', 'GB', 'CZ', 'OTHER']),
  phoneLocal: z.string().max(40).optional().default(''),
  email: z
    .string()
    .max(120)
    .optional()
    .default('')
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'clients.errors.email_invalid'),
  source: z.string().max(120).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
  socials: z
    .array(
      z.object({
        kind: z.enum(['instagram', 'facebook', 'telegram', 'custom']),
        label: z.string().max(40).optional(),
        handle: z.string().max(200),
      }),
    )
    .default([]),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  client?: ClientRow | null
  prefillName?: string
  onCreated?: (client: ClientRow) => void
}

/**
 * Форма «Новый клиент / Редактировать клиента».
 *
 * Особенности:
 * - Код страны — отдельный Select (+48 PL дефолт), остальная часть номера
 *   вводится вручную. На submit склеиваем и нормализуем в E.164.
 * - Email — валидация формата (по zod). Тип input=email + inputMode=email.
 * - Соцсети — массив {kind, label?, handle}. Можно добавить несколько.
 *   Стандартные kind: instagram, facebook, telegram. Custom — свой лейбл.
 * - «Откуда пришёл» — datalist, опции автоподтягиваются из distinct source
 *   у существующих клиентов салона (так кастомные значения остаются в
 *   списке для будущих клиентов).
 */
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
  const { data: existingClients = [] } = useClients(salonId)

  // distinct непустые source — автодополнение для datalist.
  const sourceSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const c of existingClients) {
      if (c.source && c.source.trim()) set.add(c.source.trim())
    }
    // Стандартные подсказки на случай пустого салона.
    if (set.size === 0) {
      ;['Instagram', 'Booksy', 'Google Maps', 'Рекомендация', 'Реклама', 'Прохожий'].forEach((s) =>
        set.add(s),
      )
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [existingClients])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      countryCode: 'PL',
      phoneLocal: '',
      email: '',
      source: '',
      notes: '',
      socials: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'socials',
  })

  useEffect(() => {
    if (!open) return
    const looksLikePhone =
      !!prefillName &&
      /^[\d+\s()-]+$/.test(prefillName) &&
      prefillName.replace(/[^\d]/g, '').length >= 7

    let countryCode: FormValues['countryCode'] = 'PL'
    let phoneLocal = ''
    if (client?.phone) {
      const parsed = parsePhoneIntoParts(client.phone)
      countryCode = parsed.country
      phoneLocal = parsed.local
    } else if (looksLikePhone) {
      const parsed = parsePhoneIntoParts(prefillName!)
      countryCode = parsed.country
      phoneLocal = parsed.local
    }

    form.reset({
      name: client?.name ?? (looksLikePhone ? '' : (prefillName ?? '')),
      countryCode,
      phoneLocal,
      email: client?.email ?? '',
      source: client?.source ?? '',
      notes: client?.notes ?? '',
      socials: client?.socials ?? [],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый ресет на open
  }, [open, client?.id, prefillName])

  const isEdit = !!client
  const pending = create.isPending || update.isPending

  function onSubmit(values: FormValues) {
    // Склеиваем телефон. Если phoneLocal пуст — телефон не сохраняем.
    let phoneToSave: string | null = null
    if (values.phoneLocal && values.phoneLocal.trim()) {
      const dial = COUNTRY_OPTIONS.find((c) => c.code === values.countryCode)?.dial ?? '+'
      const raw = `${dial}${values.phoneLocal.trim()}`
      phoneToSave = toE164(raw) ?? raw
    }

    // Чистим соцсети: убираем строки с пустым handle.
    const socialsClean: ClientSocial[] = values.socials
      .filter((s) => s.handle && s.handle.trim())
      .map((s) => ({
        kind: s.kind,
        ...(s.kind === 'custom' && s.label ? { label: s.label.trim() } : {}),
        handle: s.handle.trim(),
      }))

    const payload = {
      name: values.name.trim(),
      phone: phoneToSave,
      email: values.email.trim() || null,
      source: values.source.trim() || null,
      notes: values.notes.trim() || null,
      socials: socialsClean,
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

  function addSocial(kind: SocialKind) {
    append({ kind, handle: '', ...(kind === 'custom' ? { label: '' } : {}) })
  }

  const usedKinds = new Set(fields.filter((f) => f.kind !== 'custom').map((f) => f.kind))
  const availableSocials: SocialKind[] = (['instagram', 'facebook', 'telegram'] as const).filter(
    (k) => !usedKinds.has(k),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(540px,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('clients.form.title_edit') : t('clients.form.title_new')}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto px-5 pb-2 pt-3"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          {/* Имя */}
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

          {/* Телефон: страна-Select + локальная часть */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-phone-local">{t('clients.form.phone_label')}</Label>
            <div className="flex items-stretch gap-2">
              <Select
                value={form.watch('countryCode')}
                onValueChange={(v) => form.setValue('countryCode', v as FormValues['countryCode'])}
              >
                <SelectTrigger className="w-[140px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      <span className="num font-semibold">{c.dial}</span>{' '}
                      <span className="text-muted-foreground text-xs">{c.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id="cl-phone-local"
                type="tel"
                inputMode="tel"
                placeholder="600 12 34 56"
                {...form.register('phoneLocal')}
                className="num flex-1"
              />
            </div>
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-email">{t('clients.form.email_label')}</Label>
            <Input
              id="cl-email"
              type="email"
              inputMode="email"
              autoComplete="email"
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

          {/* Соцсети */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('clients.form.socials_label')}</Label>
            {fields.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {fields.map((f, idx) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <SocialIcon kind={f.kind} />
                    {f.kind === 'custom' ? (
                      <Input
                        placeholder={t('clients.form.social_kind_placeholder')}
                        {...form.register(`socials.${idx}.label` as const)}
                        className="h-9 w-[110px] shrink-0 text-sm"
                      />
                    ) : (
                      <span className="text-foreground w-[110px] shrink-0 text-sm font-semibold">
                        {socialKindLabel(f.kind, t)}
                      </span>
                    )}
                    <Input
                      placeholder={socialPlaceholder(f.kind, t)}
                      {...form.register(`socials.${idx}.handle` as const)}
                      className="h-9 flex-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="text-muted-foreground hover:text-destructive grid size-8 shrink-0 place-items-center rounded-md"
                      aria-label={t('common.delete')}
                    >
                      <Trash2 className="size-4" strokeWidth={1.7} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {/* Кнопки добавления — в одну строку (flex-nowrap), как просил
                пользователь. На узких экранах допускаем перенос. */}
            <div className="flex flex-wrap gap-1.5 sm:flex-nowrap">
              {availableSocials.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => addSocial(k)}
                  className="border-border bg-card hover:bg-muted/40 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold"
                >
                  <SocialIcon kind={k} />
                  {socialKindLabel(k, t)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => addSocial('custom')}
                className="border-border bg-card hover:bg-muted/40 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold"
              >
                <Plus className="size-3" strokeWidth={2} />
                {t('clients.form.social_add_custom')}
              </button>
            </div>
          </div>

          {/* Источник — Input + datalist стилизованный как dropdown. История
              ранее введённых значений сохраняется автоматически (distinct
              source у клиентов салона). */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-source">{t('clients.form.source_label')}</Label>
            <div className="relative">
              <Input
                id="cl-source"
                placeholder={t('clients.form.source_placeholder')}
                {...form.register('source')}
                list="cl-source-suggestions"
                className="pr-9"
              />
              <ChevronDown
                className="text-muted-foreground pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2"
                strokeWidth={1.7}
              />
            </div>
            <datalist id="cl-source-suggestions">
              {sourceSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          {/* Заметка */}
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

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function SocialIcon({ kind }: { kind: SocialKind }) {
  if (kind === 'instagram')
    return <Instagram className="text-muted-foreground size-4 shrink-0" strokeWidth={1.8} />
  if (kind === 'facebook')
    return <Facebook className="text-muted-foreground size-4 shrink-0" strokeWidth={1.8} />
  if (kind === 'telegram')
    return <Send className="text-muted-foreground size-4 shrink-0" strokeWidth={1.8} />
  return <Plus className="text-muted-foreground size-4 shrink-0" strokeWidth={2} />
}

function socialKindLabel(kind: SocialKind, t: (k: string) => string): string {
  switch (kind) {
    case 'instagram':
      return 'Instagram'
    case 'facebook':
      return 'Facebook'
    case 'telegram':
      return 'Telegram'
    default:
      return t('clients.form.social_custom')
  }
}

function socialPlaceholder(kind: SocialKind, t: (k: string) => string): string {
  switch (kind) {
    case 'instagram':
      return '@username'
    case 'facebook':
      return 'facebook.com/…'
    case 'telegram':
      return '@username или +48…'
    default:
      return t('clients.form.social_handle_placeholder')
  }
}

/**
 * Парсит существующий E.164-номер или произвольный ввод на код страны +
 * локальную часть. Если не распознан — fallback на PL + raw без +.
 */
function parsePhoneIntoParts(raw: string): {
  country: (typeof COUNTRY_OPTIONS)[number]['code']
  local: string
} {
  const trimmed = raw.trim()
  for (const c of COUNTRY_OPTIONS) {
    if (c.code === 'OTHER') continue
    if (trimmed.startsWith(c.dial)) {
      return { country: c.code, local: trimmed.slice(c.dial.length).trim() }
    }
  }
  // Если начинается с + но не наш код — OTHER + remainder
  if (trimmed.startsWith('+')) {
    return { country: 'OTHER', local: trimmed.slice(1).trim() }
  }
  // Без + — считаем что PL (дефолт)
  return { country: 'PL', local: trimmed }
}
