import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

import { ClientTemplatesSection } from './ClientTemplatesSection'
import { Facebook, Instagram, Link2, Mail, Pencil, Phone, Send, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useClientVisits, useDeleteClient, type ClientRow } from '@/hooks/useClients'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatPhoneDisplay } from '@/lib/utils/format-phone'
import { ClientFormModal } from './ClientFormModal'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  client: ClientRow | null
  currency: string
}

export function ClientDrawer({ open, onOpenChange, salonId, client, currency }: Props) {
  const { t } = useTranslation()
  const { data: visits = [], isLoading } = useClientVisits(salonId, client?.id ?? null)
  const deleteClient = useDeleteClient(salonId)
  const [editOpen, setEditOpen] = useState(false)

  function onDelete() {
    if (!client) return
    if (!confirm(t('clients.confirm_delete'))) return
    deleteClient.mutate(client.id, {
      onSuccess: () => {
        toast.success(t('clients.toast_deleted'))
        onOpenChange(false)
      },
      onError: (err) => {
        toast.error(t('clients.toast_error'), {
          description: err instanceof Error ? err.message : String(err),
        })
      },
    })
  }

  // Дата первого визита — самый старый visit_at. visits отсортированы DESC
  // (newest first), значит первый визит = последний элемент массива.
  const firstVisitDate = useMemo(() => {
    if (!visits.length) return null
    const oldest = visits.at(-1)
    if (!oldest) return null
    try {
      return format(parseISO(oldest.visit_at), 'MMMM yyyy', { locale: ru })
    } catch {
      return null
    }
  }, [visits])

  const socials = client?.socials ?? []

  if (!client) return null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{client.name}</SheetTitle>
            <p className="text-muted-foreground text-xs">
              {client.visit_count} {t('clients.drawer.visits_count')} ·{' '}
              <span className="num">{formatCurrency(client.total_revenue_cents, currency)}</span>{' '}
              {t('clients.drawer.lifetime')}
            </p>
            {firstVisitDate ? (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('clients.drawer.client_since', { date: firstVisitDate })}
              </p>
            ) : null}
          </SheetHeader>

          <SheetBody className="px-5 py-4">
            <div className="mb-6 flex flex-col gap-2">
              {client.phone ? (
                <a
                  href={`tel:${client.phone}`}
                  className="text-foreground hover:bg-muted/50 flex items-center gap-3 rounded-md p-2 text-sm"
                >
                  <Phone className="text-muted-foreground size-4" strokeWidth={1.7} />
                  <span className="num">{formatPhoneDisplay(client.phone)}</span>
                </a>
              ) : null}
              {client.email ? (
                <a
                  href={`mailto:${client.email}`}
                  className="text-foreground hover:bg-muted/50 flex items-center gap-3 rounded-md p-2 text-sm"
                >
                  <Mail className="text-muted-foreground size-4" strokeWidth={1.7} />
                  <span>{client.email}</span>
                </a>
              ) : null}
              {socials.map((s, idx) => (
                <SocialRow key={`${s.kind}-${idx}`} social={s} />
              ))}
              {client.notes ? (
                <div className="bg-muted/40 mt-2 rounded-md p-3 text-sm">
                  <p className="text-muted-foreground mb-1 text-xs font-semibold uppercase">
                    {t('clients.drawer.notes')}
                  </p>
                  <p className="text-foreground whitespace-pre-wrap">{client.notes}</p>
                </div>
              ) : null}
            </div>

            <ClientTemplatesSection salonId={salonId} clientId={client.id} />

            <h3 className="text-brand-navy mb-3 text-sm font-bold uppercase tracking-wider">
              {t('clients.drawer.history')}
            </h3>

            {isLoading ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bg-muted/60 h-14 animate-pulse rounded-md" />
                ))}
              </div>
            ) : visits.length === 0 ? (
              <p className="text-muted-foreground text-sm" data-testid="client-history-empty">
                {t('clients.drawer.history_empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visits.map((v) => (
                  <li
                    key={v.id}
                    className="border-border bg-background flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                    data-testid="client-history-row"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate font-medium">
                        {v.service_name_snapshot ?? t('clients.drawer.no_service')}
                      </p>
                      <p className="num text-muted-foreground text-xs">
                        {format(parseISO(v.visit_at), 'd MMM yyyy', { locale: ru })}
                      </p>
                    </div>
                    <span className="num text-foreground text-sm font-bold">
                      {formatCurrency(v.amount_cents + (v.tip_cents ?? 0), currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SheetBody>

          <SheetFooter>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setEditOpen(true)}
                data-testid="cl-edit"
              >
                <Pencil className="size-4" strokeWidth={1.7} />
                {t('common.edit')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onDelete}
                disabled={deleteClient.isPending}
                className="text-destructive hover:bg-destructive/10"
                data-testid="cl-delete"
                aria-label={t('common.delete')}
              >
                <Trash2 className="size-4" strokeWidth={1.7} />
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ClientFormModal
        open={editOpen}
        onOpenChange={setEditOpen}
        salonId={salonId}
        client={client}
      />
    </>
  )
}

/** Строка соц-сети в шапке карточки клиента. Ссылка если handle — это
 *  URL или @username, иначе просто текст. */
function SocialRow({ social }: { social: { kind: string; label?: string; handle: string } }) {
  const Icon =
    social.kind === 'instagram'
      ? Instagram
      : social.kind === 'facebook'
        ? Facebook
        : social.kind === 'telegram'
          ? Send
          : Link2
  const handle = social.handle?.trim() ?? ''
  const href = socialHref(social.kind, handle)
  const label = social.kind === 'custom' && social.label ? `${social.label}: ${handle}` : handle
  if (!handle) return null
  const inner = (
    <>
      <Icon className="text-muted-foreground size-4" strokeWidth={1.7} />
      <span className="truncate">{label}</span>
    </>
  )
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-foreground hover:bg-muted/50 flex items-center gap-3 rounded-md p-2 text-sm"
      >
        {inner}
      </a>
    )
  }
  return (
    <div className="text-foreground flex items-center gap-3 rounded-md p-2 text-sm">{inner}</div>
  )
}

function socialHref(kind: string, handle: string): string | null {
  if (!handle) return null
  const h = handle.trim()
  if (/^https?:\/\//i.test(h)) return h
  if (kind === 'instagram') {
    const username = h.replace(/^@/, '')
    return `https://instagram.com/${username}`
  }
  if (kind === 'facebook') {
    return h.includes('/')
      ? `https://${h.replace(/^https?:\/\//, '')}`
      : `https://facebook.com/${h}`
  }
  if (kind === 'telegram') {
    if (h.startsWith('+')) return `https://t.me/${h.replace('+', '')}`
    return `https://t.me/${h.replace(/^@/, '')}`
  }
  return null
}
