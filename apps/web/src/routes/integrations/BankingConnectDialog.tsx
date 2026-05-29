import { Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAspsps, useStartBankConnect } from '@/hooks/useBanking'

const COUNTRY_OPTIONS = [
  { code: 'PL', label_key: 'banking.countries.PL' },
  { code: 'DE', label_key: 'banking.countries.DE' },
  { code: 'FR', label_key: 'banking.countries.FR' },
  { code: 'ES', label_key: 'banking.countries.ES' },
  { code: 'IT', label_key: 'banking.countries.IT' },
  { code: 'CZ', label_key: 'banking.countries.CZ' },
  { code: 'LT', label_key: 'banking.countries.LT' },
  { code: 'LV', label_key: 'banking.countries.LV' },
  { code: 'EE', label_key: 'banking.countries.EE' },
  { code: 'FI', label_key: 'banking.countries.FI' },
  { code: 'NL', label_key: 'banking.countries.NL' },
] as const

const HISTORY_OPTIONS = [
  { value: 30, label_key: 'banking.history.30' },
  { value: 90, label_key: 'banking.history.90' },
  { value: 365, label_key: 'banking.history.365' },
  { value: 730, label_key: 'banking.history.730' },
] as const

type Props = {
  salonId: string
  open: boolean
  onClose: () => void
  /** Если задано — pre-fill для re-connect (consent истёк) */
  prefillBank?: { name: string; country: string } | null
}

export function BankingConnectDialog({ salonId, open, onClose, prefillBank }: Props) {
  const { t } = useTranslation()
  const [country, setCountry] = useState<string>('PL')
  const [search, setSearch] = useState('')
  const [bank, setBank] = useState<string>('')
  const [history, setHistory] = useState<number>(90)
  const { data: aspsps = [], isLoading } = useAspsps(open ? country : null)
  const start = useStartBankConnect(salonId)

  useEffect(() => {
    if (!open) return
    if (prefillBank) {
      setCountry(prefillBank.country || 'PL')
      setBank(prefillBank.name)
    } else {
      setBank('')
      setSearch('')
    }
  }, [open, prefillBank])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return aspsps
    return aspsps.filter((a) => a.name.toLowerCase().includes(s))
  }, [aspsps, search])

  function submit() {
    if (!bank) {
      toast.error(t('banking.errors.no_bank'))
      return
    }
    start.mutate(
      { aspsp_name: bank, aspsp_country: country, history_days: history },
      {
        onSuccess: (res) => {
          // Сохраняем connection_id чтобы callback-страница знала, что обрабатывать.
          // EB также вернёт `state=<connection_id>` в редиректе — это primary
          // источник, sessionStorage = backup для UX-аналитики.
          sessionStorage.setItem('finkley:banking:pending_connection', res.connection_id)
          // OAuth-return-onboarding флаг: если юзер сейчас в онбординге —
          // после Banking callback вернёмся туда, а не в /settings.
          try {
            if (window.location.pathname.includes('/onboarding') && salonId) {
              localStorage.setItem('finkley:oauth-return-onboarding', salonId)
            }
          } catch {
            /* ignore */
          }
          window.location.href = res.auth_url
        },
        onError: (err) =>
          toast.error(t('banking.errors.connect_failed'), {
            description: err instanceof Error ? err.message : String(err),
          }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('banking.connect_title')}</DialogTitle>
          <DialogDescription>{t('banking.connect_subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-2 pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bk-country">{t('banking.country_label')}</Label>
            <Select
              value={country}
              onValueChange={(v) => {
                setCountry(v)
                setBank('')
              }}
            >
              <SelectTrigger id="bk-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {t(c.label_key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bk-search">{t('banking.bank_label')}</Label>
            <div className="border-border bg-card flex h-10 items-center gap-2 rounded-md border px-3">
              <Search className="text-muted-foreground size-4" strokeWidth={1.7} />
              <input
                id="bk-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('banking.bank_search_placeholder')}
                className="text-foreground placeholder:text-muted-foreground/60 h-full flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            {isLoading ? (
              <div className="border-border bg-muted/30 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Loader2 className="size-4 animate-spin" strokeWidth={1.7} />
                {t('banking.loading_banks')}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t('banking.no_banks_found')}</p>
            ) : (
              <ul className="border-border max-h-56 overflow-y-auto rounded-md border">
                {filtered.map((a) => (
                  <li key={a.name}>
                    <button
                      type="button"
                      onClick={() => setBank(a.name)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                        bank === a.name
                          ? 'bg-primary/10 text-foreground'
                          : 'hover:bg-muted/40 text-foreground'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {a.logo ? (
                          <img
                            src={a.logo}
                            alt=""
                            className="size-5 rounded-sm object-contain"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                        <span>{a.name}</span>
                        {a.beta ? (
                          <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase">
                            beta
                          </span>
                        ) : null}
                      </span>
                      {bank === a.name ? (
                        <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bk-history">{t('banking.history_label')}</Label>
            <Select value={String(history)} onValueChange={(v) => setHistory(Number(v))}>
              <SelectTrigger id="bk-history">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HISTORY_OPTIONS.map((h) => (
                  <SelectItem key={h.value} value={String(h.value)}>
                    {t(h.label_key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{t('banking.history_hint')}</p>
          </div>

          <Input type="hidden" value={bank} readOnly data-testid="banking-selected-bank" />
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            disabled={!bank || start.isPending}
            onClick={submit}
            data-testid="banking-connect-submit"
          >
            {start.isPending ? t('common.loading') : t('banking.connect_cta')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
