import { Code, Copy, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
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
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/useApiKeys'

export function ApiKeysCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: keys = [] } = useApiKeys(salonId)
  const create = useCreateApiKey(salonId)
  const revoke = useRevokeApiKey(salonId)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['read'])
  const [showKey, setShowKey] = useState<string | null>(null)

  const activeKeys = keys.filter((k) => !k.revoked_at)

  function submitCreate() {
    if (!name.trim()) return toast.error(t('settings.api.errors.name_required'))
    create.mutate(
      { name: name.trim(), scopes },
      {
        onSuccess: (res) => {
          setShowKey(res.fullKey)
          setName('')
          setCreateOpen(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="flex items-start gap-3">
        <span
          className="bg-secondary/10 text-secondary grid size-9 shrink-0 place-items-center rounded-md"
          aria-hidden
        >
          <Code className="size-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-brand-navy text-base font-bold">{t('settings.api.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-snug">
            {t('settings.api.subtitle')}
          </p>
        </div>
      </div>

      {activeKeys.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {activeKeys.map((k) => (
            <li
              key={k.id}
              className="border-border bg-muted/20 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-semibold">{k.name}</p>
                <p className="text-muted-foreground num truncate text-xs">
                  {k.key_prefix}...{' '}
                  <span className="ml-1">
                    {k.scopes.join(', ')} ·{' '}
                    {t('settings.api.created', {
                      date: new Date(k.created_at).toLocaleDateString('ru-RU'),
                    })}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!confirm(t('settings.api.confirm_revoke'))) return
                  revoke.mutate(k.id, {
                    onSuccess: () => toast.success(t('settings.api.toast_revoked')),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }}
                className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                aria-label={t('settings.api.revoke_aria')}
              >
                <Trash2 className="size-4" strokeWidth={1.7} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <Button onClick={() => setCreateOpen(true)} variant="outline">
          <KeyRound className="size-4" strokeWidth={1.8} />
          {t('settings.api.create')}
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.api.create_title')}</DialogTitle>
            <DialogDescription>{t('settings.api.create_subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-5 pb-2 pt-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-name">{t('settings.api.name_label')}</Label>
              <Input
                id="api-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Zapier integration"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('settings.api.scopes_label')}</Label>
              <div className="flex gap-2">
                {(['read', 'write'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setScopes((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                      )
                    }}
                    className={
                      'rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors ' +
                      (scopes.includes(s)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-foreground hover:bg-muted/40')
                    }
                  >
                    {t(`settings.api.scope.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="px-5">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={create.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={submitCreate} disabled={create.isPending || !name.trim()}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <KeyRound className="size-4" strokeWidth={1.8} />
              )}
              {t('settings.api.create_submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show-once dialog */}
      <Dialog open={!!showKey} onOpenChange={(o) => !o && setShowKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.api.show_once_title')}</DialogTitle>
            <DialogDescription>{t('settings.api.show_once_subtitle')}</DialogDescription>
          </DialogHeader>
          {showKey ? (
            <div className="flex flex-col gap-3 px-5 pb-2 pt-3">
              <div className="border-border bg-muted/30 num text-foreground break-all rounded-md border px-3 py-2 text-sm">
                {showKey}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(showKey)
                  toast.success(t('settings.api.toast_copied'))
                }}
              >
                <Copy className="size-4" strokeWidth={1.8} />
                {t('settings.api.copy')}
              </Button>
            </div>
          ) : null}
          <DialogFooter className="px-5">
            <Button onClick={() => setShowKey(null)}>{t('settings.api.understood')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
