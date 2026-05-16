import { Banknote, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase/client'
import { useSalon } from '@/hooks/useSalons'
import { useQueryClient } from '@tanstack/react-query'

/**
 * CashDisciplineCard — секция Settings → Профиль → «Касса».
 * Включатель кассового дня для салона. Когда выключен — таб «Касса» в
 * Финансах скрыт, а расчёт визита / создание расхода не требуют открытой
 * смены. Default = false (фича opt-in).
 */
export function CashDisciplineCard({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: salon, isLoading } = useSalon(salonId)

  async function toggle(next: boolean) {
    // Перед выключением проверяем что нет открытых смен — иначе они
    // окажутся «в подвешенном состоянии» (auto-close их закроет позже).
    if (!next) {
      const { count } = await supabase
        .from('cash_shifts')
        .select('id', { count: 'exact', head: true })
        .eq('salon_id', salonId)
        .eq('status', 'open')
      if (count && count > 0) {
        const ok = window.confirm(
          t('settings.cash_discipline.confirm_disable_with_open', { count }),
        )
        if (!ok) return
      }
    }
    const { error } = await supabase
      .from('salons')
      .update({ cash_discipline_enabled: next })
      .eq('id', salonId)
    if (error) {
      toast.error(t('settings.cash_discipline.toast_error'), {
        description: error.message,
      })
      return
    }
    toast.success(
      next ? t('settings.cash_discipline.toast_on') : t('settings.cash_discipline.toast_off'),
    )
    await qc.invalidateQueries({ queryKey: ['salons'] })
  }

  if (isLoading || !salon) {
    return (
      <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
        <Loader2 className="text-muted-foreground size-4 animate-spin" strokeWidth={2} />
      </section>
    )
  }

  const enabled = salon.cash_discipline_enabled === true

  return (
    <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-2">
        <Banknote className="text-brand-navy size-4" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.cash_discipline.title')}
        </h2>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        {t('settings.cash_discipline.description')}
      </p>

      <div className="border-border/60 bg-muted/20 flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-semibold">
            {enabled
              ? t('settings.cash_discipline.state_on')
              : t('settings.cash_discipline.state_off')}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {enabled
              ? t('settings.cash_discipline.state_on_hint')
              : t('settings.cash_discipline.state_off_hint')}
          </p>
        </div>
        {/* Простой кастомный switch — без отдельного зависимого компонента. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => toggle(!enabled)}
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-muted-foreground/30'
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </section>
  )
}
