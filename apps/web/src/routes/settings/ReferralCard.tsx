import { Copy, Gift, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useReferralCode, useReferralUses } from '@/hooks/useReferral'

export function ReferralCard() {
  const { t } = useTranslation()
  const { data: code, isLoading } = useReferralCode()
  const { data: uses = [] } = useReferralUses()

  const activated = uses.filter((u) => u.activated_at).length

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="flex items-start gap-3">
        <span
          className="bg-brand-yellow/40 text-brand-navy grid size-9 shrink-0 place-items-center rounded-md"
          aria-hidden
        >
          <Gift className="size-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-brand-navy text-base font-bold">{t('settings.referral.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-snug">
            {t('settings.referral.subtitle')}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : code ? (
          <div className="flex items-center gap-2">
            <code className="border-border bg-muted/40 flex-1 rounded-md border px-3 py-2.5 text-base font-bold tracking-widest">
              {code}
            </code>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                navigator.clipboard.writeText(code)
                toast.success(t('settings.referral.toast_copied'))
              }}
            >
              <Copy className="size-4" strokeWidth={1.8} />
              {t('settings.referral.copy')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="border-border mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
        <div>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
            {t('settings.referral.invited')}
          </p>
          <p className="text-brand-navy num mt-0.5 text-xl font-bold">{uses.length}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
            {t('settings.referral.activated')}
          </p>
          <p className="text-brand-sage num mt-0.5 text-xl font-bold">{activated}</p>
        </div>
      </div>

      <p className="text-muted-foreground mt-3 text-xs">{t('settings.referral.fineprint')}</p>
    </section>
  )
}
