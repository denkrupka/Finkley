import { Mail, Phone, Send, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaffEditSheet } from '@/routes/staff/StaffEditSheet'
import { formatError } from '@/lib/format-error'
import { supabase } from '@/lib/supabase/client'
import { useStaff, type StaffRow } from '@/hooks/useStaff'
import { useInviteMember } from '@/hooks/useTeam'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Live-режим Step2Staff: показывает мастеров уже импортированных из
 * Booksy (после login в предыдущем шаге их подтягивает background-sync).
 * Каждая карточка с avatar + email/phone + кнопка «Пригласить» (one-shot
 * link через send-invitation edge function). Возможность добавить
 * нового мастера прямо тут.
 *
 * Используется в OnboardingPage когда state.created_salon_id есть.
 * Без salonId — fallback на старый Step2Staff (draft в state).
 */
export function Step2StaffLive({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: staff = [], isLoading } = useStaff(salonId, { activeOnly: true })
  const invite = useInviteMember(salonId)

  // Bug 37b3b3e0 (Елена 05.06): «Добавить мастера» открывает тот же sheet,
  // что и при редактировании в /staff — со схемой выплат, %, расписанием,
  // долей с ретейла и окном возвратов. Полный набор, как в справочнике.
  const [sheetStaff, setSheetStaff] = useState<StaffRow | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  function openCreate() {
    setSheetStaff(null)
    setSheetOpen(true)
  }

  function openEdit(s: StaffRow) {
    setSheetStaff(s)
    setSheetOpen(true)
  }

  async function removeStaff(id: string) {
    if (!confirm(t('common.confirm_delete'))) return
    try {
      const { error } = await supabase.from('staff').update({ is_active: false }).eq('id', id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    } catch (err) {
      toast.error(formatError(err))
    }
  }

  function sendInvite(
    s: { id: string; full_name: string; email: string | null; phone: string | null },
    channel: 'email' | 'sms',
  ) {
    // Для SMS требуется phone; для email — email. Если ничего нет — guard.
    if (channel === 'email' && !s.email) {
      toast.error(t('onboarding.step2.invite_need_email'))
      return
    }
    if (channel === 'sms' && !s.phone) {
      toast.error(t('onboarding.step2.invite_need_phone'))
      return
    }
    invite.mutate(
      {
        // Email обязателен для accept-flow; для SMS-only ставим заглушку,
        // backend всё равно создаст row и пошлёт SMS со ссылкой.
        email: s.email ?? `staff+${s.id}@no-email.finkley.local`,
        role: 'staff',
        staffId: s.id,
        phone: s.phone ?? undefined,
        first_name: s.full_name.split(' ')[0],
        last_name: s.full_name.split(' ').slice(1).join(' '),
        channel,
      },
      {
        onSuccess: () =>
          toast.success(
            channel === 'sms'
              ? t('onboarding.step2.invite_sent_sms', {
                  phone: s.phone,
                  defaultValue: 'SMS-приглашение отправлено на {{phone}}',
                })
              : t('onboarding.step2.invite_sent', {
                  email: s.email,
                  defaultValue: 'Приглашение отправлено на {{email}}',
                }),
          ),
        onError: (err) => toast.error(formatError(err)),
      },
    )
  }

  if (isLoading) {
    return (
      <div>
        <div className="bg-muted/50 mb-3 h-8 w-1/3 animate-pulse rounded-md" />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-border bg-card animate-pulse rounded-lg border p-4"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex items-start gap-3">
                <div className="bg-muted size-12 rounded-full" />
                <div className="flex-1">
                  <div className="bg-muted h-4 w-2/3 rounded" />
                  <div className="bg-muted mt-2 h-3 w-1/2 rounded" />
                </div>
              </div>
              <div className="bg-muted mt-3 h-9 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
        {t('onboarding.step2.title')}
      </h1>

      {staff.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('onboarding.step2.empty_hint')}</p>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {staff.map((s) => {
          const initial = (s.full_name || '?').trim().charAt(0).toUpperCase() || '?'
          return (
            <div
              key={s.id}
              className="border-border bg-card shadow-finsm rounded-lg border p-4"
              data-testid="onb-staff-card-live"
            >
              <div className="flex items-start gap-3">
                {s.avatar_url ? (
                  <img
                    src={s.avatar_url}
                    alt={s.full_name}
                    className="size-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="bg-brand-teal-soft text-brand-teal-deep grid size-12 shrink-0 place-items-center rounded-full text-base font-bold">
                    {initial}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  className="min-w-0 flex-1 text-left"
                  aria-label="edit"
                >
                  <p className="text-foreground hover:text-brand-teal-deep truncate text-sm font-bold transition-colors">
                    {s.full_name}
                  </p>
                  {s.email ? (
                    <p className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 truncate text-xs">
                      <Mail className="size-3" strokeWidth={1.8} /> {s.email}
                    </p>
                  ) : null}
                  {s.phone ? (
                    <p className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 truncate text-xs">
                      <Phone className="size-3" strokeWidth={1.8} /> {s.phone}
                    </p>
                  ) : null}
                  {s.external_source === 'booksy' ? (
                    <span className="bg-brand-teal-soft text-brand-teal-deep mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                      Booksy
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => removeStaff(s.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="remove"
                >
                  <Trash2 className="size-4" strokeWidth={1.7} />
                </button>
              </div>
              {s.invite_sent_at ? (
                <div className="border-brand-sage bg-brand-sage-soft/30 text-brand-sage-deep mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border-[1.5px] px-3 py-2 text-xs font-bold">
                  <Send className="size-3.5" strokeWidth={2} />
                  {t('onboarding.step2.invite_already_sent')}
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => sendInvite(s, 'email')}
                    disabled={invite.isPending || !s.email}
                    title={!s.email ? t('onboarding.step2.invite_need_email') : undefined}
                    className="border-brand-teal-deep text-brand-teal-deep hover:bg-brand-teal-soft/40 inline-flex items-center justify-center gap-1 rounded-md border-[1.5px] px-2 py-2 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Mail className="size-3.5" strokeWidth={2} />
                    {t('onboarding.step2.invite_email_btn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => sendInvite(s, 'sms')}
                    disabled={invite.isPending || !s.phone}
                    title={!s.phone ? t('onboarding.step2.invite_need_phone') : undefined}
                    className="border-brand-teal-deep text-brand-teal-deep hover:bg-brand-teal-soft/40 inline-flex items-center justify-center gap-1 rounded-md border-[1.5px] px-2 py-2 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Phone className="size-3.5" strokeWidth={2} />
                    {t('onboarding.step2.invite_sms_btn')}
                  </button>
                </div>
              )}
            </div>
          )
        })}

        <button
          type="button"
          onClick={openCreate}
          className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-transparent p-4 transition-colors"
          data-testid="onb-staff-add-live"
        >
          <div className="border-brand-border-strong bg-card grid size-11 place-items-center rounded-full border-[1.5px]">
            <UserPlus className="size-[18px]" strokeWidth={1.7} />
          </div>
          <span className="text-sm font-semibold">{t('onboarding.step2.add')}</span>
        </button>
      </div>

      <StaffEditSheet
        open={sheetOpen}
        onOpenChange={(v) => {
          setSheetOpen(v)
          if (!v) setSheetStaff(null)
        }}
        salonId={salonId}
        staff={sheetStaff}
      />
    </div>
  )
}
