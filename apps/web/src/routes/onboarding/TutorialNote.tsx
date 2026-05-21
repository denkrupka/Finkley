import { Lightbulb } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Образовательный info-блок над контентом каждого шага онбординга —
 * объясняет «что и зачем» простыми словами. На своих скриншотах юзер
 * показал что без таких подсказок шаги непонятные.
 */
export function TutorialNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-brand-gold-soft bg-brand-gold-soft/30 mb-5 flex items-start gap-3 rounded-md border p-3.5">
      <Lightbulb className="text-brand-gold-deep mt-0.5 size-4 shrink-0" strokeWidth={2.2} />
      <p className="text-brand-navy text-[12.5px] leading-relaxed">{children}</p>
    </div>
  )
}
