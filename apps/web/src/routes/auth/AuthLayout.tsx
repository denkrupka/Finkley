import type { ReactNode } from 'react'

import { LogoLockup } from '@/components/ui/logo'

/**
 * Layout-обёртка для всех auth-страниц (/login, /signup, /forgot-password, /reset-password).
 * Центрированная карточка на bg, лого слева сверху.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="flex h-16 items-center px-6 sm:px-8">
        <LogoLockup size={32} />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p> : null}
          </div>
          <div className="border-border bg-card shadow-finsm rounded-lg border p-6 sm:p-8">
            {children}
          </div>
          {footer ? <div className="mt-6 text-center text-sm">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}
