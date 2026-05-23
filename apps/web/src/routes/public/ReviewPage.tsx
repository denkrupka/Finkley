import { Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'

type SalonInfo = {
  id: string
  name: string | null
  logo_url: string | null
  google_place_url: string | null
  locale: string | null
}

/**
 * Public /review/:token — собираем отзыв после визита.
 * - 5 звёзд → редирект на Google Maps
 * - 1-4 → форма «оставить отзыв» → reviews row (visibility=private)
 *
 * FlySMS-style flow. Не требует auth — только token из URL.
 */
export function ReviewPage() {
  const { t, i18n } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [phase, setPhase] = useState<'loading' | 'rate' | 'feedback' | 'done' | 'error'>('loading')
  const [salon, setSalon] = useState<SalonInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
  const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const FN_URL = `${SUPABASE_URL}/functions/v1/review-submit`
  // Supabase Edge требует Bearer ANON для всех вызовов — публичная страница
  // /review/:token без auth-сессии, но anon-ключ сам по себе ничего не открывает,
  // RLS защищает данные через token-валидацию внутри функции.
  // useMemo чтобы избежать react-hooks/exhaustive-deps warning в useEffect ниже.
  const AUTH_HEADERS = useMemo(
    () => ({ authorization: `Bearer ${SUPABASE_ANON}`, apikey: SUPABASE_ANON }),
    [SUPABASE_ANON],
  )

  useEffect(() => {
    if (!token) {
      setPhase('error')
      setError('missing_token')
      return
    }
    void fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, { headers: AUTH_HEADERS })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error)
          setPhase('error')
          return
        }
        const s = data.salon as SalonInfo
        setSalon(s)
        if (s?.locale) {
          const base = s.locale.split('-')[0]
          if (base && i18n.language !== base) void i18n.changeLanguage(base)
        }
        setPhase('rate')
      })
      .catch(() => {
        setError('network')
        setPhase('error')
      })
  }, [token, FN_URL, i18n, AUTH_HEADERS])

  async function submitRating(stars: number) {
    if (!token || submitting) return
    if (stars === 5) {
      setSubmitting(true)
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
        body: JSON.stringify({ token, rating: 5 }),
      })
      const data = await res.json()
      if (data.action === 'redirect_google' && data.google_place_url) {
        window.location.href = data.google_place_url
        return
      }
      setPhase('done')
      setSubmitting(false)
      return
    }
    // 1-4 → форма
    setRating(stars)
    setPhase('feedback')
  }

  async function submitFeedback() {
    if (!token || !rating || submitting) return
    setSubmitting(true)
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        rating,
        review_body: bodyText.trim() || null,
        author_name: authorName.trim() || null,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (data.ok) setPhase('done')
    else {
      setError(data.error ?? 'unknown')
      setPhase('error')
    }
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-5 py-10">
      <div className="border-border bg-card shadow-finmd w-full max-w-md rounded-2xl border p-8">
        {salon?.logo_url ? (
          <img
            src={salon.logo_url}
            alt={salon.name ?? ''}
            className="mx-auto mb-6 max-h-16 w-auto"
          />
        ) : (
          <h2 className="text-brand-navy mb-6 text-center text-xl font-bold">
            {salon?.name ?? 'Finkley'}
          </h2>
        )}

        {phase === 'loading' ? (
          <p className="text-muted-foreground text-center text-sm">{t('common.loading')}</p>
        ) : phase === 'error' ? (
          <div className="text-center">
            <p className="text-destructive text-sm font-semibold">
              {error === 'expired'
                ? t('review.expired')
                : error === 'not_found'
                  ? t('review.not_found')
                  : error === 'already_submitted'
                    ? t('review.already_submitted')
                    : t('review.error_generic')}
            </p>
          </div>
        ) : phase === 'rate' ? (
          <>
            <h1 className="text-brand-navy text-center text-xl font-bold">
              {t('review.rate_title')}
            </h1>
            <p className="text-muted-foreground mt-2 text-center text-sm">
              {t('review.rate_subtitle', { salon: salon?.name ?? '' })}
            </p>
            <div className="mt-6 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={submitting}
                  onClick={() => submitRating(n)}
                  className="text-brand-gold-deep transition-transform hover:scale-110 disabled:opacity-50"
                  aria-label={`${n} ${t('review.stars')}`}
                >
                  <Star className="size-12" strokeWidth={1.5} fill="currentColor" />
                </button>
              ))}
            </div>
          </>
        ) : phase === 'feedback' ? (
          <>
            <h1 className="text-brand-navy text-center text-xl font-bold">
              {t('review.feedback_title', { rating: rating ?? 0 })}
            </h1>
            <p className="text-muted-foreground mt-2 text-center text-sm">
              {t('review.feedback_subtitle')}
            </p>
            <input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder={t('review.your_name')}
              className="border-border bg-background focus:border-primary mt-5 h-11 w-full rounded-md border px-3 text-sm outline-none"
            />
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder={t('review.feedback_placeholder')}
              rows={5}
              className="border-border bg-background focus:border-primary mt-3 w-full resize-none rounded-md border p-3 text-sm outline-none"
            />
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => setPhase('rate')} disabled={submitting}>
                {t('common.back')}
              </Button>
              <Button onClick={submitFeedback} disabled={submitting} className="flex-1">
                {submitting ? t('common.loading') : t('review.submit')}
              </Button>
            </div>
          </>
        ) : phase === 'done' ? (
          <div className="text-center">
            <h1 className="text-brand-navy text-xl font-bold">{t('review.done_title')}</h1>
            <p className="text-muted-foreground mt-2 text-sm">{t('review.done_subtitle')}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
