import { Check, Loader2, MapPin, Search, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

/**
 * Поиск места через Google Places API (как в Google Maps).
 * Юзер вводит название («Зефир Warszawa»), мы дёргаем edge function
 * `google-places-search`, показываем дроп с фото/адресом/рейтингом,
 * клик → onPick({ google_place_id, address, lat, lng, google_maps_uri }).
 *
 * Фото — через edge function `google-places-photo` (прокси, чтобы API
 * key не светился в URL).
 */

type Place = {
  id: string
  name: string
  address: string | null
  location: { lat: number; lng: number } | null
  photo_name: string | null
  rating: number | null
  rating_count: number | null
  google_maps_uri: string | null
}

type PickedPlace = {
  google_place_id: string
  google_maps_uri: string | null
  address: string | null
  lat: number | null
  lng: number | null
  name: string
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export function GooglePlaceSearchInput({
  initialName,
  initialPlaceId,
  language,
  onPick,
  onClear,
}: {
  /** Что показать как «уже выбрано» — обычно salon.name или ранее найденное имя. */
  initialName?: string | null
  /** Если уже есть google_place_id — показываем компактный состояние «выбрано», без поиска. */
  initialPlaceId?: string | null
  /** Язык поиска. По умолчанию из i18n. */
  language?: string
  onPick: (place: PickedPlace) => void
  /** Снять выбранное место (обнулить google_place_id). */
  onClear: () => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounce — 300 ms тишины перед запросом.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(id)
  }, [query])

  // Закрытие dropdown при клике снаружи.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Триггерим search при изменении debounced query.
  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([])
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void supabase.functions
      .invoke('google-places-search', {
        body: { query: debouncedQuery, language: language ?? i18n.language.split('-')[0] },
      })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setResults([])
          return
        }
        const places = (data as { places?: Place[] } | null)?.places ?? []
        setResults(places)
        setOpen(places.length > 0)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setResults([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, language, i18n.language])

  const photoUrlFor = useMemo(
    () => (photoName: string | null) =>
      photoName
        ? `${SUPABASE_URL}/functions/v1/google-places-photo?name=${encodeURIComponent(photoName)}&w=120`
        : null,
    [],
  )

  function handlePick(p: Place) {
    onPick({
      google_place_id: p.id,
      google_maps_uri: p.google_maps_uri,
      address: p.address,
      lat: p.location?.lat ?? null,
      lng: p.location?.lng ?? null,
      name: p.name,
    })
    setQuery('')
    setResults([])
    setOpen(false)
  }

  // Состояние «уже выбрано» — компактный chip с кнопкой «Изменить».
  if (initialPlaceId) {
    return (
      <div className="border-brand-sage-soft bg-brand-sage-soft/30 flex items-center gap-3 rounded-lg border p-3">
        <div className="bg-brand-sage grid size-9 shrink-0 place-items-center rounded-md text-white">
          <Check className="size-4" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-brand-sage-deep truncate text-sm font-semibold">
            {initialName ?? t('settings.profile.place_search.selected')}
          </p>
          <p className="text-muted-foreground truncate font-mono text-[10px]">{initialPlaceId}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
        >
          <X className="size-3" strokeWidth={2} />
          {t('settings.profile.place_search.clear')}
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
          strokeWidth={1.8}
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={t('settings.profile.place_search.placeholder')}
          className="pl-10"
          data-testid="place-search-input"
        />
        {loading ? (
          <Loader2
            className="text-muted-foreground absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin"
            strokeWidth={2}
          />
        ) : null}
      </div>

      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}

      {open && results.length > 0 ? (
        <div className="border-border bg-card shadow-finmd absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-md border">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePick(p)}
              className="hover:bg-muted/40 border-border/40 flex w-full items-start gap-3 border-b p-3 text-left last:border-b-0"
            >
              <div className="bg-muted size-16 shrink-0 overflow-hidden rounded-md">
                {p.photo_name ? (
                  <img
                    src={photoUrlFor(p.photo_name) ?? ''}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground grid size-full place-items-center">
                    <MapPin className="size-5" strokeWidth={1.7} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-semibold">{p.name}</p>
                {p.address ? (
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{p.address}</p>
                ) : null}
                {p.rating != null ? (
                  <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-[11px]">
                    <Star
                      className={cn(
                        'size-3 shrink-0',
                        p.rating >= 4
                          ? 'text-brand-gold-deep fill-current'
                          : 'text-muted-foreground',
                      )}
                      strokeWidth={1.5}
                    />
                    <span className="num font-semibold">{p.rating.toFixed(1)}</span>
                    {p.rating_count != null ? (
                      <span className="opacity-70">({p.rating_count})</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-muted-foreground mt-1.5 text-xs">
        {t('settings.profile.place_search.hint')}
      </p>
    </div>
  )
}
