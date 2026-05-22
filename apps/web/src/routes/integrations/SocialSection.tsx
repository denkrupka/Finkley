import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, Facebook, Info, Instagram } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

/**
 * Settings → Интеграции → Соцсети.
 *
 * Показывает статус подключения Facebook Page и Instagram. Реальное OAuth
 * подключение делается в существующей вкладке «Мессенджеры» (там тот же
 * Meta App, те же scopes). Здесь — обзорная панель + ссылка на подключение
 * + объяснение что эти подключения дают для отчётов (метрики страницы в
 * Reports → Конкуренты → Контент).
 *
 * Если в будущем понадобится отдельный OAuth flow с другими scopes (например
 * pages_read_engagement для метрик без messenger), создадим отдельную
 * edge function. Сейчас переиспользуем messenger_integrations токены —
 * этого достаточно для read-доступа к public page данным.
 */
export function SocialSection({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  type Row = {
    channel: string
    status: string
    display_name: string | null
    external_account_id: string | null
  }
  const integrations = useQuery<Row[]>({
    queryKey: ['messenger-integrations-social', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messenger_integrations')
        .select('channel, status, display_name, external_account_id')
        .eq('salon_id', salonId)
        .in('channel', ['fb_page', 'instagram'])
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })

  const byChannel = new Map<string, Row>()
  for (const i of integrations.data ?? []) byChannel.set(i.channel, i)
  const fb = byChannel.get('fb_page')
  const ig = byChannel.get('instagram')

  return (
    <div className="flex flex-col gap-4">
      <div className="border-brand-teal-soft bg-brand-teal-soft/30 flex items-start gap-3 rounded-md border p-4">
        <Info className="text-brand-teal-deep mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <p className="text-foreground text-[12.5px] leading-relaxed">
          {t('integrations.social.info')}
        </p>
      </div>

      <SocialCard
        icon={Facebook}
        brandColor="#1877F2"
        title="Facebook Page"
        subtitle={t('integrations.social.fb_subtitle')}
        connected={fb?.status === 'connected'}
        connectedLabel={fb?.display_name ?? fb?.external_account_id ?? ''}
        salonId={salonId}
      />
      <SocialCard
        icon={Instagram}
        brandColor="#E1306C"
        title="Instagram"
        subtitle={t('integrations.social.ig_subtitle')}
        connected={ig?.status === 'connected'}
        connectedLabel={ig?.display_name ?? ig?.external_account_id ?? ''}
        salonId={salonId}
      />

      <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
        <Info className="mt-0.5 size-3 shrink-0" strokeWidth={2} />
        {t('integrations.social.footer')}
      </p>
    </div>
  )
}

function SocialCard({
  icon: Icon,
  brandColor,
  title,
  subtitle,
  connected,
  connectedLabel,
  salonId,
}: {
  icon: typeof Facebook
  brandColor: string
  title: string
  subtitle: string
  connected: boolean
  connectedLabel: string
  salonId: string
}) {
  const { t } = useTranslation()
  return (
    <section
      className={cn(
        'border-border bg-card shadow-finsm flex items-start gap-4 rounded-lg border p-5',
        connected && 'border-brand-sage-soft bg-brand-sage-soft/20',
      )}
    >
      <div
        className="grid size-10 shrink-0 place-items-center rounded-lg text-white"
        style={{ background: brandColor }}
      >
        <Icon className="size-5" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-foreground text-base font-bold">{title}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{subtitle}</p>
          </div>
          {connected ? (
            <span className="bg-brand-sage inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-white">
              <Check className="size-3" strokeWidth={2.4} />
              {t('integrations.social.connected_badge')}
            </span>
          ) : null}
        </div>
        {connected && connectedLabel ? (
          <p className="text-brand-sage-deep mt-2 text-xs font-semibold">{connectedLabel}</p>
        ) : null}
        <div className="mt-3">
          <Button asChild size="sm" variant={connected ? 'outline' : 'primary'}>
            <Link to={`/${salonId}/settings/integrations?tab=messengers`}>
              <ExternalLink className="size-3.5" strokeWidth={2} />
              {connected
                ? t('integrations.social.manage_button')
                : t('integrations.social.connect_button')}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
