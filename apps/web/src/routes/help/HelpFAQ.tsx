import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { usePermissions } from '@/hooks/usePermissions'
import { cn } from '@/lib/utils/cn'

const FAQ_KEYS: string[] = [
  'help.q.what',
  'help.q.signup',
  'help.q.add_visit',
  'help.q.bulk_visits',
  'help.q.import_booksy',
  'help.q.expenses',
  'help.q.payouts',
  'help.q.reports',
  'help.q.cancel',
  'help.q.export_data',
  'help.q.delete_account',
  'help.q.support',
]

/** Owner-вопросы, нерелевантные мастеру (биллинг/аккаунт салона). */
const OWNER_ONLY_FAQ = new Set<string>([
  'help.q.cancel',
  'help.q.export_data',
  'help.q.delete_account',
])

/**
 * Аккордеон с FAQ. Используется и в полностраничном /help, и в табе Help
 * внутри Settings. Все тексты — в `help.q.*` ключах i18n.
 */
export function HelpFAQ() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { role } = usePermissions(salonId)
  // Мастеру (staff/external) не показываем owner-вопросы (биллинг/аккаунт).
  const isMaster = role === 'staff' || role === 'external'
  const keys = isMaster ? FAQ_KEYS.filter((k) => !OWNER_ONLY_FAQ.has(k)) : FAQ_KEYS
  const [open, setOpen] = useState<string | null>(null)

  return (
    <ul className="border-border bg-card shadow-finsm divide-border divide-y overflow-hidden rounded-lg border">
      {keys.map((key) => {
        const isOpen = open === key
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : key)}
              className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors"
              aria-expanded={isOpen}
            >
              <span className="text-foreground text-base font-semibold">{t(`${key}.title`)}</span>
              <ChevronDown
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform',
                  isOpen ? 'rotate-180' : '',
                )}
                strokeWidth={2}
              />
            </button>
            {isOpen ? (
              <div className="text-foreground/80 px-5 pb-4 text-sm leading-relaxed">
                <p className="whitespace-pre-wrap">{t(`${key}.body`)}</p>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
