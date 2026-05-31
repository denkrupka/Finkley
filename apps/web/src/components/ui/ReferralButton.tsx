import { Copy, Gift, Mail, MessageCircle, Send } from 'lucide-react'
import { useState } from 'react'
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
import { useReferralCode, useReferralUses } from '@/hooks/useReferral'

/**
 * Жёлтая кнопка «Пригласи друзей». Клик → модалка с линком, share-кнопками
 * (TG/WA/Email/Copy) и статистикой.
 *
 * Варианты:
 *  - `topbar` (по умолчанию, legacy): pill 36px в TopBar.
 *  - `sidebar`: широкая кнопка во всю ширину футера сайдбара.
 */
export function ReferralButton({ variant = 'topbar' }: { variant?: 'topbar' | 'sidebar' } = {}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: code } = useReferralCode()
  const { data: uses = [] } = useReferralUses()

  const link =
    typeof window !== 'undefined' && code ? `${window.location.origin}/app/signup?ref=${code}` : ''
  const shareText = t('referral.share_text', { link })

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('referral.toast_copied'))
    } catch {
      toast.error(t('common.error'))
    }
  }

  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('referral.share_title'))}`
  const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`
  const mailUrl = `mailto:?subject=${encodeURIComponent(t('referral.share_title'))}&body=${encodeURIComponent(shareText)}`

  const activated = uses.filter((u) => u.activated_at !== null).length
  const sent = uses.length

  const isSidebar = variant === 'sidebar'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('referral.bonus_cta')}
        aria-label={t('referral.bonus_cta')}
        className={
          isSidebar
            ? 'border-brand-yellow-deep/50 inline-flex w-full items-center justify-center gap-2 rounded-md border bg-gradient-to-br from-[#FFFCEB] to-[#FFE876] px-3 py-2 transition-shadow hover:shadow-sm'
            : 'border-brand-yellow-deep/50 inline-flex h-9 items-center gap-1.5 rounded-full border bg-gradient-to-br from-[#FFFCEB] to-[#FFE876] px-2.5 transition-shadow hover:shadow-sm sm:px-3'
        }
      >
        <Gift
          className={isSidebar ? 'text-brand-gold size-5 shrink-0' : 'text-brand-gold size-4'}
          strokeWidth={2}
        />
        {isSidebar ? (
          <span className="flex flex-col items-start leading-tight">
            <span className="text-brand-navy-ink text-[12px] font-bold">
              {t('referral.bonus_cta')}
            </span>
            <span className="text-brand-navy-ink/70 text-[10px] font-medium">
              {t('referral.bonus_hint')}
            </span>
          </span>
        ) : (
          <span className="text-brand-navy-ink hidden text-[11px] font-bold sm:inline">
            {t('referral.button')}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:!max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="text-brand-gold size-5" strokeWidth={1.8} />
              {t('referral.modal_title')}
            </DialogTitle>
            <DialogDescription>{t('referral.modal_subtitle')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 px-5 pb-2">
            {/* Link copy */}
            <div className="border-border flex items-center gap-2 rounded-md border p-2">
              <code className="text-foreground flex-1 truncate text-xs">
                {link || t('common.loading')}
              </code>
              <button
                type="button"
                onClick={copyLink}
                className="text-secondary hover:bg-secondary/10 grid size-7 place-items-center rounded-md"
                title={t('referral.copy')}
              >
                <Copy className="size-3.5" strokeWidth={1.8} />
              </button>
            </div>

            {/* Share buttons */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ShareBtn href={tgUrl} bg="#229ED9" icon={Send} label="Telegram" />
              <ShareBtn href={waUrl} bg="#25D366" icon={MessageCircle} label="WhatsApp" />
              <ShareBtn href={mailUrl} bg="#0F4C5C" icon={Mail} label="Email" external={false} />
              <button
                type="button"
                onClick={copyLink}
                className="border-border bg-card hover:bg-muted/40 flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition-colors"
              >
                <Copy className="size-3.5" strokeWidth={1.8} />
                {t('referral.copy')}
              </button>
            </div>

            {/* Stats */}
            <div className="border-border grid grid-cols-2 gap-3 rounded-md border p-3">
              <div>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  {t('referral.stats_sent')}
                </p>
                <p className="num text-foreground mt-1 text-2xl font-bold">{sent}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  {t('referral.stats_activated')}
                </p>
                <p className="num text-brand-sage-deep mt-1 text-2xl font-bold">{activated}</p>
              </div>
            </div>

            {/* Usage list */}
            {uses.length > 0 ? (
              <ul className="border-border max-h-40 overflow-y-auto rounded-md border text-xs">
                {uses.map((u) => (
                  <li
                    key={u.id}
                    className="border-border/60 flex items-center justify-between gap-3 border-b px-3 py-1.5 last:border-b-0"
                  >
                    <span className="text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString('ru-RU')}
                    </span>
                    <span
                      className={
                        u.activated_at
                          ? 'text-brand-sage-deep font-semibold'
                          : 'text-muted-foreground'
                      }
                    >
                      {u.activated_at ? t('referral.activated') : t('referral.pending')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ShareBtn({
  href,
  bg,
  icon: Icon,
  label,
  external = true,
}: {
  href: string
  bg: string
  icon: typeof Send
  label: string
  external?: boolean
}) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
      style={{ background: bg }}
    >
      <Icon className="size-3.5" strokeWidth={2} />
      {label}
    </a>
  )
}
