import { Loader2, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccountingConnect } from '@/hooks/useIntegrations'
import { consumeOnboardingCredentials } from '@/lib/onboarding-credentials'
import { supabase } from '@/lib/supabase/client'

import type { IntegrationDef, IntegrationProvider } from './integrations-config'

const ACCOUNTING_PROVIDERS: IntegrationProvider[] = ['fakturownia', 'infakt']

/**
 * Маппинг treatwell-proxy error codes на i18n ключи. Owner-feedback 04.06:
 * дифференцируем причины NOT_AUTHENTICATED (solver не настроен / solver
 * не сработал / Treatwell отверг credentials после solver).
 */
function pickTreatwellErrorKey(raw: string): string | null {
  if (raw.includes('treatwell_solver_not_configured'))
    return 'integrations.errors.treatwell_solver_not_configured'
  if (raw.includes('treatwell_solver_failed')) return 'integrations.errors.treatwell_solver_failed'
  if (raw.includes('treatwell_invalid_credentials'))
    return 'integrations.errors.treatwell_invalid_credentials'
  return null
}

function isAccountingProvider(id: IntegrationProvider): id is 'fakturownia' | 'infakt' {
  return ACCOUNTING_PROVIDERS.includes(id)
}

/**
 * Generic connect-форма для провайдеров, которые подключаются через простой
 * набор полей (subdomain/api_token/login/...). Использует useAccountingConnect
 * для реальных бухгалтерских порталов; для остальных (Fresha/Treatwell/
 * YCLIENTS — все coming_soon) показывает stub-toast.
 *
 * Booksy / wFirma / KSeF имеют выделенные диалоги (см. соответствующие *.tsx).
 */
export function ConnectIntegrationDialog({
  provider,
  onClose,
  salonId: salonIdProp,
}: {
  provider: IntegrationDef | null
  onClose: () => void
  salonId?: string
}) {
  const { t } = useTranslation()
  const { salonId: salonIdFromUrl } = useParams<{ salonId: string }>()
  const salonId = salonIdProp ?? salonIdFromUrl
  const [values, setValues] = useState<Record<string, string>>({})

  const accountingId = provider && isAccountingProvider(provider.id) ? provider.id : null
  const connect = useAccountingConnect(accountingId, salonId)

  useEffect(() => {
    // T150 — pre-fill credentials собранных в онбординге для этого provider.
    if (provider && salonId) {
      const creds = consumeOnboardingCredentials(salonId, provider.id)
      setValues(creds ?? {})
    } else {
      setValues({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id, salonId])

  function explainError(code: string): string {
    // Универсальные коды ошибок accounting-портала. Конкретные коды каждый
    // провайдер отдаёт сам — здесь даём fallback.
    const map: Record<string, string> = {
      fields_required: 'integrations.errors.fields_required',
      fakturownia_invalid_credentials: 'integrations.errors.fakturownia_invalid_credentials',
      fakturownia_invalid_subdomain: 'integrations.errors.fakturownia_invalid_subdomain',
      fakturownia_api_error: 'integrations.errors.fakturownia_api_error',
      infakt_invalid_credentials: 'integrations.errors.infakt_invalid_credentials',
      infakt_api_error: 'integrations.errors.infakt_api_error',
      not_partner_yet: 'integrations.errors.infakt_not_partner_yet',
    }
    const key = map[code]
    return key ? t(key) : code
  }

  function handleSubmit() {
    if (!provider) return
    const missing = provider.connectFields.filter(
      (f) => f.required && !(values[f.key] ?? '').trim(),
    )
    if (missing.length > 0) {
      toast.error(t('integrations.errors.fields_required'))
      return
    }
    if (!accountingId) {
      // Treatwell / Fresha: дёргаем соответствующий proxy. Sync будет
      // включён после реализации в следующем спринте; connect сохраняет
      // venue_id и помечает интеграцию connected — юзер видит зелёный
      // badge и понимает что credentials приняты.
      const proxyMap: Record<string, string> = {
        treatwell: 'treatwell-proxy',
        fresha: 'fresha-proxy',
        bookon: 'bookon-proxy',
      }
      const proxy = provider ? proxyMap[provider.id] : undefined
      if (proxy && salonId) {
        ;(async () => {
          const { data, error } = await supabase.functions.invoke(proxy, {
            body: {
              action: 'connect',
              salon_id: salonId,
              login: values.login,
              password: values.password,
              account_id: values.account_id,
              access_key: values.access_key,
            },
          })
          if (error) {
            const raw = error.message ?? String(error)
            const errKey = pickTreatwellErrorKey(raw)
            toast.error(errKey ? t(errKey) : raw)
            return
          }
          const res = data as { ok?: boolean; error?: string; note?: string } | null
          if (!res?.ok) {
            const code = res?.error ?? 'connect_failed'
            const errKey = pickTreatwellErrorKey(code)
            toast.error(errKey ? t(errKey) : code)
            return
          }
          toast.success(
            res.note ?? t('integrations.toast_connected', { name: provider?.name ?? '' }),
          )
          // Auto-sync сразу после connect (только для treatwell — Fresha
          // Data Connector pull пока не реализован).
          if (provider?.id === 'treatwell') {
            toast.info(
              t('integrations.toast_sync_started', { name: provider?.name ?? 'Treatwell' }),
            )
            const syncRes = await supabase.functions.invoke('treatwell-proxy', {
              body: { action: 'sync', salon_id: salonId, days: 30 },
            })
            if (syncRes.error) {
              toast.error(syncRes.error.message ?? String(syncRes.error))
            } else {
              const s = syncRes.data as {
                ok?: boolean
                stats?: { staff: number; services: number; clients: number; visits: number }
              }
              if (s.ok && s.stats) {
                toast.success(
                  t('integrations.toast_synced', {
                    staff: s.stats.staff,
                    services: s.stats.services,
                    visits: s.stats.visits,
                  }),
                )
              }
            }
          }
          onClose()
        })()
        return
      }
      toast.success(t('integrations.toast_saved_stub'))
      onClose()
      return
    }
    connect.mutate(values, {
      onSuccess: () => {
        toast.success(t('integrations.toast_connected', { name: provider.name }))
        onClose()
      },
      onError: (err) => {
        const code = err instanceof Error ? err.message : String(err)
        toast.error(explainError(code))
      },
    })
  }

  return (
    <Dialog open={provider !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('integrations.connect_title', { name: provider?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t('integrations.connect_subtitle', { name: provider?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 px-5 pb-2 pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          {provider?.connectFields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`int-${field.key}`}>{t(field.label_key)}</Label>
              <Input
                id={`int-${field.key}`}
                type={field.type}
                autoComplete={field.type === 'password' ? 'current-password' : 'username'}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((s) => ({ ...s, [field.key]: e.target.value }))}
              />
            </div>
          ))}

          <div className="border-secondary/30 bg-secondary/5 flex items-start gap-2 rounded-md border p-3">
            <Lock className="text-secondary mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
            <p className="text-foreground/80 text-xs leading-snug">
              {accountingId
                ? t('integrations.security_note_accounting')
                : t('integrations.security_note')}
            </p>
          </div>
        </form>

        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={connect.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={connect.isPending}>
            {connect.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                {t('integrations.connecting')}
              </>
            ) : (
              t('integrations.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
