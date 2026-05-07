import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
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

import type { IntegrationDef } from './integrations-config'

/**
 * Generic connect-форма для провайдеров со stub-логином (Fresha/Treatwell/
 * YCLIENTS — все coming_soon). Booksy использует отдельный BooksyConnectDialog
 * с invisible hCaptcha + proxy POST.
 */
export function ConnectIntegrationDialog({
  provider,
  onClose,
}: {
  provider: IntegrationDef | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>({})
  const isPending = false

  // Сбрасываем поля при смене провайдера
  useEffect(() => {
    setValues({})
  }, [provider?.id])

  function handleSubmit() {
    if (!provider) return
    const missing = provider.connectFields.filter(
      (f) => f.required && !(values[f.key] ?? '').trim(),
    )
    if (missing.length > 0) {
      toast.error(t('integrations.errors.fields_required'))
      return
    }
    toast.success(t('integrations.toast_saved_stub'))
    onClose()
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
              {t('integrations.security_note')}
            </p>
          </div>
        </form>

        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {t('integrations.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
