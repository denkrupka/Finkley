import { type ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'
import { Label } from './label'

/**
 * Минимальная обёртка для одного поля формы:
 * - label сверху
 * - control (Input/Select/...) ниже
 * - текст ошибки (если есть) под полем красным
 *
 * Не используем тяжёлый shadcn `Form`/`FormField` (требует RHF context-wrapper),
 * вместо него — RHF `register` + явный `<Field>` per поле. Меньше магии.
 */
export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string
  label: ReactNode
  error?: string | null
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs font-medium" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  )
}
