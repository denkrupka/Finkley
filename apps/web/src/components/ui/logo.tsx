/**
 * Логотип Finkley. Два варианта:
 * - `monogram` — квадратная плитка с буквой F (для sidebar, шапок, мобильных)
 * - `wordmark` — широкий векторный логотип из Design/Logo (для лендинга, splash)
 */

import { cn } from '@/lib/utils/cn'

export function LogoMonogram({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        'bg-primary text-primary-foreground grid place-items-center rounded-md',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        letterSpacing: '-0.06em',
      }}
      aria-hidden
    >
      <span className="font-display font-extrabold leading-none">F</span>
    </div>
  )
}

export function LogoWordmark({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <img
      src="/logo.svg"
      alt="Finkley"
      style={{ height, width: 'auto' }}
      className={cn('select-none', className)}
      draggable={false}
    />
  )
}

/**
 * Композит: монограмма + текст «Finkley» рядом.
 * Используется в sidebar/onboarding header.
 */
export function LogoLockup({
  size = 30,
  className,
  hideText = false,
}: {
  size?: number
  className?: string
  /** bug 94dd5f53 — collapsed sidebar: показать только монограмму без текста. */
  hideText?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMonogram size={size} />
      {hideText ? null : (
        <span className="font-display text-brand-navy text-base font-bold tracking-tight">
          Finkley
        </span>
      )}
    </div>
  )
}
