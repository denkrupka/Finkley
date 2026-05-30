import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Facebook, Instagram, Send, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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

// «Своя» соцсеть (custom) удалена по запросу — в реальной жизни 99% клиентов
// используют только Instagram/Facebook/Telegram. Если когда-нибудь понадобится
// VK/TikTok/др — вернём позже отдельной задачей.
type SocialKind = 'instagram' | 'facebook' | 'telegram'

type FormValues = {
  name: string
  countryCode: (typeof COUNTRY_OPTIONS)[number]['code']
  phoneLocal: string
  email: string
  source: string
  notes: string
  socials: { kind: SocialKind; handle: string }[]
  discountPercent: string // строкой в форме чтобы пустое = null
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
        kind: z.enum(['instagram', 'facebook', 'telegram']),
        handle: z.string().max(200),
      }),
    )
    .default([]),
  discountPercent: z
    .string()
    .optional()
    .default('')
    .refine((v) => {
      if (!v) return true
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 && n <= 100
    }, 'clients.errors.discount_invalid'),
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
      ;[
        'Instagram',
        'Booksy',
        'Google Maps',
        t('clients.form.source_suggestion.referral', { defaultValue: 'Рекомендация' }),
        t('clients.form.source_suggestion.ad', { defaultValue: 'Реклама' }),
        t('clients.form.source_suggestion.walk_in', { defaultValue: 'Прохожий' }),
      ].forEach((s) => set.add(s))
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [existingClients, t])

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
      // Custom-соцсети из legacy данных фильтруем — теперь поддерживаются
      // только instagram/facebook/telegram.
      socials: (client?.socials ?? []).filter(
        (s): s is { kind: SocialKind; handle: string } => s.kind !== 'custom',
      ),
      discountPercent:
        client?.discount_percent !== null && client?.discount_percent !== undefined
          ? String(client.discount_percent)
          : '',
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
        handle: s.handle.trim(),
      }))

    const discountRaw = values.discountPercent?.trim() ?? ''
    const discountToSave = discountRaw === '' ? null : Number(discountRaw)

    const payload = {
      name: values.name.trim(),
      phone: phoneToSave,
      email: values.email.trim() || null,
      source: values.source.trim() || null,
      notes: values.notes.trim() || null,
      socials: socialsClean,
      discount_percent: discountToSave,
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
    append({ kind, handle: '' })
  }

  const usedKinds = new Set(fields.map((f) => f.kind))
  const availableSocials: SocialKind[] = (['instagram', 'facebook', 'telegram'] as const).filter(
    (k) => !usedKinds.has(k),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(820px,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('clients.form.title_edit') : t('clients.form.title_new')}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-3 px-5 pb-2 pt-3"
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
                    <span className="text-foreground w-[110px] shrink-0 text-sm font-semibold">
                      {socialKindLabel(f.kind)}
                    </span>
                    <Input
                      placeholder={socialPlaceholder(f.kind)}
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
            {/* Кнопки добавления соцсетей. «Своя» удалена — 99% клиентов
                используют только эти три, лишнее загромождало UI. */}
            <div className="flex flex-wrap gap-1.5 sm:flex-nowrap">
              {availableSocials.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => addSocial(k)}
                  className="border-border bg-card hover:bg-muted/40 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold"
                >
                  <SocialIcon kind={k} />
                  {socialKindLabel(k)}
                </button>
              ))}
            </div>
          </div>

          {/* Источник — combobox с поиском и опцией «Добавить новый».
              Distinct source у уже созданных клиентов салона + дефолтные
              подсказки если база пуста. */}
          <SourceCombobox
            value={form.watch('source')}
            onChange={(v) => form.setValue('source', v)}
            suggestions={sourceSuggestions}
            placeholder={t('clients.form.source_placeholder')}
            label={t('clients.form.source_label')}
            addPrefix={t('clients.form.source_add', { defaultValue: 'Добавить:' })}
          />

          {/* Персональная скидка % — auto-apply в форме визита */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-discount">{t('clients.form.discount_label')}</Label>
            <div className="relative">
              <Input
                id="cl-discount"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                placeholder="0"
                {...form.register('discountPercent')}
                className="num pr-8"
              />
              <span className="text-muted-foreground pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                %
              </span>
            </div>
            <p className="text-muted-foreground text-xs">{t('clients.form.discount_hint')}</p>
            {form.formState.errors.discountPercent ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.discountPercent.message ?? '')}
              </p>
            ) : null}
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
  return <Send className="text-muted-foreground size-4 shrink-0" strokeWidth={1.8} />
}

function socialKindLabel(kind: SocialKind): string {
  switch (kind) {
    case 'instagram':
      return 'Instagram'
    case 'facebook':
      return 'Facebook'
    case 'telegram':
      return 'Telegram'
  }
}

function socialPlaceholder(kind: SocialKind): string {
  switch (kind) {
    case 'instagram':
      return '@username'
    case 'facebook':
      return 'facebook.com/…'
    case 'telegram':
      return '@username или +48…'
  }
}

/**
 * Combobox для поля «Откуда пришёл клиент»:
 *   - Input с поиском (фильтрует по substring case-insensitive).
 *   - Dropdown со списком отфильтрованных подсказок.
 *   - Если в подсказках нет точного совпадения — пункт «+ Добавить "X"»
 *     которое сразу сохраняет value (новое значение).
 *   - Закрытие по клику снаружи и Escape.
 */
function SourceCombobox({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
  addPrefix,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder: string
  label: string
  addPrefix: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const query = value.trim().toLowerCase()
  const filtered = query ? suggestions.filter((s) => s.toLowerCase().includes(query)) : suggestions
  const exactMatch = suggestions.some((s) => s.toLowerCase() === query)
  const canAdd = !!value.trim() && !exactMatch

  return (
    <div className="flex flex-col gap-1.5" ref={wrapRef}>
      <Label htmlFor="cl-source">{label}</Label>
      <div className="relative">
        <Input
          id="cl-source"
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="pr-9"
          autoComplete="off"
        />
        <ChevronDown
          className="text-muted-foreground pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2"
          strokeWidth={1.7}
        />
        {open && (filtered.length > 0 || canAdd) ? (
          <div className="border-border bg-card shadow-finmd absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border py-1">
            {filtered.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onChange(s)
                  setOpen(false)
                }}
                className="hover:bg-muted/50 text-foreground block w-full px-3 py-1.5 text-left text-sm"
              >
                {s}
              </button>
            ))}
            {canAdd ? (
              <button
                type="button"
                onClick={() => {
                  // Просто закрываем — value уже введено юзером, оно сохранится
                  // как новое (база distinct.source автоматически подхватит для
                  // следующего клиента).
                  setOpen(false)
                }}
                className="hover:bg-muted/50 text-brand-teal-deep border-border block w-full border-t px-3 py-1.5 text-left text-sm font-semibold"
              >
                {addPrefix} <span className="text-foreground">«{value.trim()}»</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
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
