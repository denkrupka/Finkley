import { CheckCircle2, MapPin, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GooglePlaceSearchInput } from '@/components/settings/GooglePlaceSearchInput'
import { Field } from '@/components/ui/field'
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
  }
  onChange: (v: Partial<Props['value']>) => void
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
export function Step1Salon({ value, onChange }: Props) {
  const { t } = useTranslation()
  const placePicked = !!value.address.google_place_id

  return (
    <div>
      <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
        {t('onboarding.step1.title', { defaultValue: 'Расскажи о салоне' })}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step1.subtitle', {
          defaultValue:
            'Найди салон в Google — мы сразу подтянем адрес и координаты, ничего вписывать не нужно. Если нет в Google — введи имя руками.',
        })}
      </p>

      <div className="mt-7 flex flex-col gap-6">
        {/* Google Places — самое важное, сверху */}
        <Field
          id="onb-place"
          label={t('onboarding.step1.place_label', { defaultValue: 'Найти салон в Google' })}
        >
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
            placeholder={t('onboarding.step1.name_placeholder', {
              defaultValue: 'Например, «Wonderful Beauty»',
            })}
            data-testid="onb-name"
          />
        </Field>

        <Field
          id="onb-country"
          label={t('onboarding.step1.country_label', { defaultValue: 'Страна и валюта' })}
        >
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
          <p className="text-muted-foreground mt-1.5 text-xs">
            {t('onboarding.step1.country_hint', {
              defaultValue: 'Мы определили страну автоматически по твоему IP. Можешь поменять.',
            })}
          </p>
        </Field>

        <Field
          id="onb-type"
          label={t('onboarding.step1.type_label', { defaultValue: 'Тип салона' })}
        >
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
              {t('onboarding.step1.benchmarks_title', {
                defaultValue: 'Сравнить мой салон с похожими (анонимно)',
              })}
            </p>
            <p className="text-muted-foreground mt-1 text-xs leading-snug">
              {t('onboarding.step1.benchmarks_body', {
                defaultValue:
                  'Мы будем сравнивать твои показатели (выручка/мастер, средний чек, retention) со средним по нише в твоей стране. Анонимно, твои цифры никому не показываем. Зато ты увидишь чёткое «я лучше/хуже рынка».',
              })}
            </p>
            {value.benchmarks_opt_in ? (
              <p className="text-brand-sage-deep mt-1.5 inline-flex items-center gap-1 text-xs font-bold">
                <CheckCircle2 className="size-3.5" strokeWidth={2.2} />
                {t('onboarding.step1.benchmarks_on', { defaultValue: 'Согласие — сравнивать' })}
              </p>
            ) : null}
          </div>
        </label>
      </div>
    </div>
  )
}
