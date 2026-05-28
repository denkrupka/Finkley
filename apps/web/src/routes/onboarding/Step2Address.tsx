import { MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GooglePlaceSearchInput } from '@/components/settings/GooglePlaceSearchInput'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type AddressDraft = {
  address: string
  city: string
  lat: string
  lng: string
  google_place_id: string | null
  google_place_url: string | null
}

export function Step2Address({
  value,
  onChange,
}: {
  value: AddressDraft
  onChange: (v: AddressDraft) => void
}) {
  const { t } = useTranslation()

  function patch<K extends keyof AddressDraft>(key: K, v: AddressDraft[K]) {
    onChange({ ...value, [key]: v })
  }

  return (
    <div className="space-y-3">
      <h2 className="text-brand-navy text-2xl font-bold tracking-tight">
        {t('onboarding.step_address.title')}
      </h2>

      <div>
        <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider">
          {t('onboarding.step_address.search_label')}
        </Label>
        <GooglePlaceSearchInput
          initialName={null}
          initialPlaceId={value.google_place_id}
          onPick={(p) => {
            onChange({
              ...value,
              google_place_id: p.google_place_id,
              google_place_url: p.google_maps_uri ?? null,
              address: p.address ?? value.address,
              lat: p.lat != null ? String(p.lat) : value.lat,
              lng: p.lng != null ? String(p.lng) : value.lng,
              // Город — эвристика: предпоследний компонент адреса.
              city:
                p.address
                  ?.split(',')
                  .map((s) => s.trim())
                  .slice(-2, -1)[0] ?? value.city,
            })
          }}
          onClear={() => patch('google_place_id', null)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label
            htmlFor="ob-addr"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
          >
            {t('onboarding.step_address.address_label')}
          </Label>
          <div className="relative">
            <MapPin
              className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
              strokeWidth={1.8}
            />
            <Input
              id="ob-addr"
              value={value.address}
              onChange={(e) => patch('address', e.target.value)}
              placeholder={t('onboarding.step_address.address_placeholder')}
              className="pl-10"
            />
          </div>
        </div>
        <div>
          <Label
            htmlFor="ob-city"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
          >
            {t('onboarding.step_address.city_label')}
          </Label>
          <Input
            id="ob-city"
            value={value.city}
            onChange={(e) => patch('city', e.target.value)}
            placeholder={t('onboarding.step_address.city_placeholder')}
          />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider">
            {t('onboarding.step_address.coords_label')}
          </Label>
          <div className="flex gap-2">
            <Input
              value={value.lat}
              onChange={(e) => patch('lat', e.target.value)}
              placeholder="52.2297"
              className="num"
            />
            <Input
              value={value.lng}
              onChange={(e) => patch('lng', e.target.value)}
              placeholder="21.0122"
              className="num"
            />
          </div>
        </div>
      </div>

    </div>
  )
}
