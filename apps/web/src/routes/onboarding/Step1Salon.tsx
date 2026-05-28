import { CheckCircle2, ImagePlus, Loader2, MapPin, Sparkles, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { GooglePlaceSearchInput } from '@/components/settings/GooglePlaceSearchInput'
import { Field } from '@/components/ui/field'
import { ImageCropper } from '@/components/ui/ImageCropper'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'

import type { AddressDraft } from './Step2Address'
import {
  COUNTRY_OPTIONS,
  SALON_TYPES,
  type CountryCode,
  type SalonTypeId,
} from './onboarding-defaults'

type Props = {
  value: {
    name: string
    country_code: CountryCode
    salon_type: SalonTypeId
    address: AddressDraft
    benchmarks_opt_in: boolean
    /** Полная ветка: data URL логотипа (webp blob, ≤512px). После submit
     *  отправляется в Storage. NULL — без логотипа. */
    logo_data_url: string | null
  }
  onChange: (v: Partial<Props['value']>) => void
  /** В полной ветке показываем блок загрузки логотипа — в быстрой нет. */
  showLogo?: boolean
}

/**
 * Step 1 — профиль салона. Объединяет 4 микро-блока в один шаг:
 *
 *   1. Поиск по Google Places (если юзер находит — забираем имя+адрес+
 *      координаты+place_id; вручную имя вводить не нужно).
 *   2. Имя салона (предзаполнено из Google или пустое).
 *   3. Страна (предзаполнена IP-detect, см. detectCountryByIp).
 *   4. Тип салона (8 пресетов из SALON_TYPES).
 *   5. Бенчмарки opt-in — согласие сравнить с похожими салонами; включено
 *      по умолчанию, юзер может снять. Прямо тут — чтобы не возвращать
 *      на финальный шаг для одного чекбокса.
 */
export function Step1Salon({ value, onChange, showLogo = false }: Props) {
  const { t } = useTranslation()
  const placePicked = !!value.address.google_place_id
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  }

  return (
    <div>
      <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
        {t('onboarding.step1.title')}
      </h1>

      <div className="mt-4 flex flex-col gap-3">
        {/* Google Places — самое важное, сверху */}
        <Field id="onb-place" label={t('onboarding.step1.place_label')}>
          <GooglePlaceSearchInput
            initialName={value.name || null}
            initialPlaceId={value.address.google_place_id ?? null}
            onPick={(p) => {
              onChange({
                name: p.name || value.name,
                address: {
                  ...value.address,
                  google_place_id: p.google_place_id,
                  google_place_url: p.google_maps_uri ?? null,
                  address: p.address ?? value.address.address,
                  lat: p.lat != null ? String(p.lat) : value.address.lat,
                  lng: p.lng != null ? String(p.lng) : value.address.lng,
                },
              })
            }}
            onClear={() => {
              onChange({
                address: {
                  ...value.address,
                  google_place_id: null,
                  google_place_url: null,
                },
              })
            }}
          />
          {placePicked && value.address.address ? (
            <p className="text-muted-foreground mt-2 inline-flex items-center gap-1.5 text-xs">
              <MapPin className="text-brand-sage size-3.5" strokeWidth={2} />
              {value.address.address}
            </p>
          ) : null}
        </Field>

        {/* Ручное имя — если не нашлось в Google */}
        <Field
          id="onb-name"
          label={t('onboarding.step1.name_label', {
            defaultValue: placePicked ? 'Имя салона (можно изменить)' : 'Имя салона',
          })}
        >
          <Input
            id="onb-name"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t('onboarding.step1.name_placeholder')}
            data-testid="onb-name"
          />
        </Field>

        <Field id="onb-country" label={t('onboarding.step1.country_label')}>
          <div className="flex flex-wrap gap-2" data-testid="onb-country">
            {COUNTRY_OPTIONS.map((c) => {
              const active = value.country_code === c.code
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => onChange({ country_code: c.code })}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-accent/50',
                  )}
                >
                  {t(`onboarding.country.${c.code}`, { defaultValue: c.name })}
                  <span
                    className={cn(
                      'ml-1.5 text-[11px] font-medium',
                      active ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {c.currency}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>

        {/* Логотип — только в полной ветке (T81). В быстрой пропускаем чтобы
            не задерживать на необязательном поле. */}
        {showLogo ? (
          <Field id="onb-logo" label={t('onboarding.step1.logo_label')}>
            <div className="flex items-center gap-4">
              {value.logo_data_url ? (
                <img
                  src={value.logo_data_url}
                  alt="logo preview"
                  className="border-border bg-card size-16 rounded-md border object-contain"
                />
              ) : (
                <div className="border-border bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-md border text-xs">
                  —
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 5 * 1024 * 1024) {
                    toast.error(t('onboarding.step1.logo_too_large'))
                    e.target.value = ''
                    return
                  }
                  setCropFile(f)
                  e.target.value = ''
                }}
              />
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="border-border bg-card hover:bg-muted/40 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <ImagePlus className="size-3.5" strokeWidth={2} />
                  )}
                  {value.logo_data_url
                    ? t('onboarding.step1.logo_change')
                    : t('onboarding.step1.logo_upload')}
                </button>
                {value.logo_data_url ? (
                  <button
                    type="button"
                    onClick={() => onChange({ logo_data_url: null })}
                    className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1.5 self-start text-xs"
                  >
                    <Trash2 className="size-3" strokeWidth={1.8} />
                    {t('onboarding.step1.logo_remove')}
                  </button>
                ) : null}
              </div>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs">
              {t('onboarding.step1.logo_hint')}
            </p>
          </Field>
        ) : null}

        <Field id="onb-type" label={t('onboarding.step1.type_label')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="onb-type">
            {SALON_TYPES.map((typ) => {
              const active = value.salon_type === typ.id
              return (
                <button
                  key={typ.id}
                  type="button"
                  onClick={() => onChange({ salon_type: typ.id })}
                  className={cn(
                    'rounded-lg border p-3 text-left text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow-finsm'
                      : 'border-border bg-card text-foreground hover:border-brand-border-strong',
                  )}
                >
                  {typ.name}
                </button>
              )
            })}
          </div>
        </Field>

        {/* Бенчмарки opt-in — самая «продажная» галка. Включено по умолчанию. */}
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all',
            value.benchmarks_opt_in
              ? 'border-brand-sage bg-brand-sage-soft/30'
              : 'border-border bg-card hover:border-brand-sage/50',
          )}
        >
          <input
            type="checkbox"
            checked={value.benchmarks_opt_in}
            onChange={(e) => onChange({ benchmarks_opt_in: e.target.checked })}
            className="accent-brand-sage mt-0.5 size-5 shrink-0 cursor-pointer"
          />
          <div className="min-w-0 flex-1">
            <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
              <Sparkles className="text-brand-sage size-4" strokeWidth={2} />
              {t('onboarding.step1.benchmarks_title')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
              {t('onboarding.step1.benchmarks_body_v2')}
            </p>
            {value.benchmarks_opt_in ? (
              <p className="text-brand-sage-deep mt-1.5 inline-flex items-center gap-1 text-xs font-bold">
                <CheckCircle2 className="size-3.5" strokeWidth={2.2} />
                {t('onboarding.step1.benchmarks_on')}
              </p>
            ) : null}
          </div>
        </label>
      </div>

      <ImageCropper
        file={cropFile}
        aspect={null}
        maxOutputSize={512}
        onCancel={() => setCropFile(null)}
        onCrop={async (blob) => {
          setUploading(true)
          try {
            const dataUrl = await blobToDataUrl(blob)
            onChange({ logo_data_url: dataUrl })
            setCropFile(null)
          } finally {
            setUploading(false)
          }
        }}
      />
    </div>
  )
}
