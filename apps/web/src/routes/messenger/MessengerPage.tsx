import { formatDistanceToNowStrict } from 'date-fns'
import {
  CalendarPlus,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Facebook,
  Image as ImageIcon,
  Instagram,
  Mail,
  MessageCircle,
  Mic,
  Paperclip,
  Phone,
  Play,
  Plus,
  Search,
  Send,
  Smile,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { getDateLocale } from '@/lib/utils/format-date'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  getMessengerMediaUrl,
  useBulkBroadcast,
  useConversationMessages,
  useConversations,
  useLinkConversationClient,
  useMarkConversationRead,
  useMessengerIntegrations,
  useMessengerRealtime,
  useSendMessage,
  uploadMessengerMedia,
  type MessengerChannel,
  type MessengerConversation,
  type MessengerMessage,
} from '@/hooks/useMessenger'
import {
  getTgMediaSignedUrl,
  isTgConvId,
  makeTgConvId,
  parseTgConvId,
  useTgDialogOpen,
  useTgDialogs,
  useTgMarkRead,
  useTgMessages,
  useTgReact,
  useTgRealtime,
  useTgSendFile,
  useTgSendText,
  useTgSignedUrls,
  type TgDialog,
  type TgMessage,
} from '@/hooks/useTgMessenger'
import { useTgSessions } from '@/hooks/useTgUserbot'
import { ClientFormModal } from '@/routes/clients/ClientFormModal'
import { cn } from '@/lib/utils/cn'

/**
 * Нормализует display_name conversation'а. Если фон-сервис не смог достать
 * имя/username из Meta/IG Graph (приватный профиль, нет prompts permission),
 * webhook сохраняет дефолт `User XXXXXX`. На UI показываем понятный fallback
 * вместо технического id.
 */
function displayNameOrFallback(conv: { display_name?: string | null }, fallback: string): string {
  const name = (conv.display_name ?? '').trim()
  if (!name) return fallback
  if (/^User\s+[A-Za-z0-9]+$/.test(name)) return fallback
  return name
}

/** Адаптер TgDialog → MessengerConversation для переиспользования UI-компонентов. */
function tgDialogToConv(d: TgDialog, avatarUrl: string | null): MessengerConversation {
  return {
    id: makeTgConvId(d.id),
    salon_id: '',
    channel: 'telegram',
    external_user_id: String(d.tg_chat_id),
    display_name: d.title || d.username || '—',
    avatar_url: avatarUrl,
    client_id: null,
    unread_count: d.unread_count,
    last_message_at: d.last_message_at || new Date(0).toISOString(),
    last_message_preview: d.last_message_text,
    created_at: d.last_message_at || new Date(0).toISOString(),
    archived_at: d.archived ? new Date().toISOString() : null,
  } as unknown as MessengerConversation
}

type TgMessageAdapted = MessengerMessage & {
  read_by_recipient_at?: string | null
  reactions?: { emoji: string; count: number; chosen: boolean }[] | null
  media_pending?: boolean
  tg_message_id?: number
  _isTg?: true
}

/** Адаптер TgMessage → MessengerMessage для переиспользования MessageBody. */
function tgMessageToMsg(m: TgMessage): TgMessageAdapted {
  // Маппинг media_kind: tg использует photo/video/voice/sticker/animation/document,
  // bot api использует image/video/audio/file/sticker. Конвертируем.
  const mediaKindMap: Record<string, MessengerMessage['media_kind']> = {
    photo: 'image',
    video: 'video',
    voice: 'audio',
    sticker: 'image',
    document: 'file',
    animation: 'video',
    video_note: 'video',
  }
  return {
    id: m.id,
    conversation_id: makeTgConvId(m.dialog_id),
    direction: m.is_outgoing ? 'out' : 'in',
    text: m.text || m.media_caption,
    media_path: m.media_path,
    media_kind: m.media_kind ? (mediaKindMap[m.media_kind] ?? 'file') : null,
    created_at: m.sent_at,
    read_by_recipient_at: m.read_by_recipient_at,
    reactions: m.reactions,
    media_pending: m.media_pending,
    tg_message_id: m.tg_message_id,
    _isTg: true,
  } as TgMessageAdapted
}

/**
 * Встроенный мессенджер. Унифицирует входящие из подключённых каналов
 * (Telegram / WhatsApp / Instagram / Facebook). Layout — две колонки:
 *   слева  — список чатов с фильтром по каналу + поиск
 *   справа — лента сообщений + composer (текст / фото) + quick-actions.
 *
 * Quick-action «Создать визит» в шапке чата открывает FAB QuickEntryModal
 * с prefill = клиент (если matched по messenger_conversations.client_id).
 *
 * Bulk-рассылка — модалка «Рассылка», выбираем conversations + текст.
 */

const CHANNEL_META: Record<
  MessengerChannel,
  { label: string; labelKey: string; color: string; icon: typeof MessageCircle }
> = {
  telegram: {
    label: 'Telegram',
    labelKey: 'messenger.channel.telegram',
    color: '#229ED9',
    icon: Send,
  },
  whatsapp: {
    label: 'WhatsApp',
    labelKey: 'messenger.channel.whatsapp',
    color: '#25D366',
    icon: Phone,
  },
  instagram: {
    label: 'Instagram',
    labelKey: 'messenger.channel.instagram',
    color: '#E4405F',
    icon: Instagram,
  },
  facebook: {
    label: 'Facebook',
    labelKey: 'messenger.channel.facebook',
    color: '#1877F2',
    icon: Facebook,
  },
  email: {
    label: 'Email',
    labelKey: 'messenger.channel.email',
    color: '#0F4C5C',
    icon: Mail,
  },
  internal: {
    label: 'Внутренний',
    labelKey: 'messenger.channel.internal',
    color: '#6B7280',
    icon: MessageCircle,
  },
}

export function MessengerPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [activeChannel, setActiveChannel] = useState<MessengerChannel | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messageSearch, setMessageSearch] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [clientFormOpen, setClientFormOpen] = useState(false)
  const [lightboxMessageId, setLightboxMessageId] = useState<string | null>(null)
  const linkClient = useLinkConversationClient(salonId)

  useMessengerRealtime(salonId)
  useTgRealtime(salonId)
  // Bot API conversations — фильтруем telegram-channel (юзаем userbot вместо)
  const { data: botConversations = [], isLoading: convLoading } = useConversations(salonId, {
    channel: activeChannel,
    search,
  })
  const { data: tgDialogs = [] } = useTgDialogs(salonId)
  const { data: tgSessions = [] } = useTgSessions(salonId)
  const activeTgSession = tgSessions.find((s) => s.status === 'active') ?? null
  // Каналы которые реально подключены в интеграциях — фильтр-pill'ы
  // мессенджера должны показывать только их (запрос юзера 31.05).
  const { data: messengerIntegrations = [] } = useMessengerIntegrations(salonId)
  const connectedChannels = useMemo<Set<MessengerChannel>>(() => {
    const set = new Set<MessengerChannel>()
    for (const it of messengerIntegrations) {
      if (it.status === 'connected') set.add(it.channel)
    }
    // Telegram User-Bot (userbot) — отдельный от messenger_integrations канал.
    if (activeTgSession) set.add('telegram')
    return set
  }, [messengerIntegrations, activeTgSession])

  // Аватарки TG-диалогов (batch signed URLs)
  const avatarPaths = useMemo(() => tgDialogs.map((d) => d.photo_path), [tgDialogs])
  const avatarUrlMap = useTgSignedUrls(avatarPaths)

  // Объединённый список: Bot API без telegram + tg_dialogs как telegram
  const conversations = useMemo(() => {
    const filtered = botConversations.filter((c) => c.channel !== 'telegram')
    const tgConvs = tgDialogs
      .map((d) => tgDialogToConv(d, d.photo_path ? (avatarUrlMap[d.photo_path] ?? null) : null))
      .filter((c) => {
        if (activeChannel && activeChannel !== 'telegram') return false
        if (search && !c.display_name?.toLowerCase().includes(search.toLowerCase())) return false
        return true
      })
    // Объединяем + сортируем по last_message_at desc
    return [...filtered, ...tgConvs].sort(
      (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
    )
  }, [botConversations, tgDialogs, avatarUrlMap, activeChannel, search])

  const selectedIsTg = isTgConvId(selectedId)
  const selectedTgDialogId = selectedIsTg ? parseTgConvId(selectedId!) : null

  // Сообщения: либо Bot API, либо tg_messages
  const { data: botMessages = [] } = useConversationMessages(
    !selectedIsTg && selectedId ? selectedId : undefined,
  )
  const { data: tgMessages = [] } = useTgMessages(selectedTgDialogId ?? undefined)
  // Lazy media + open/close trекинг (только для TG)
  useTgDialogOpen(
    selectedIsTg && activeTgSession ? activeTgSession.id : undefined,
    selectedTgDialogId ?? undefined,
    tgMessages,
  )
  const allMessages = useMemo(
    () => (selectedIsTg ? tgMessages.map(tgMessageToMsg) : botMessages),
    [selectedIsTg, botMessages, tgMessages],
  )
  // Поиск по сообщениям в открытом чате
  const messages = useMemo(() => {
    const q = messageSearch.trim().toLowerCase()
    if (!q) return allMessages
    return allMessages.filter((m) => (m.text || '').toLowerCase().includes(q))
  }, [allMessages, messageSearch])

  // При смене чата — сбрасываем поиск по сообщениям и lightbox
  useEffect(() => {
    setMessageSearch('')
    setLightboxMessageId(null)
  }, [selectedId])

  // Список изображений в текущем чате (для перелистывания в lightbox)
  const imageMessages = useMemo(
    () =>
      messages.filter((m) => m.media_kind === 'image' && m.media_path) as Array<
        MessengerMessage & { _isTg?: boolean }
      >,
    [messages],
  )

  const sendMessage = useSendMessage(salonId)
  const markRead = useMarkConversationRead(salonId)
  const tgSendText = useTgSendText(salonId)
  const tgSendFile = useTgSendFile(salonId)
  const tgMarkRead = useTgMarkRead()
  const tgReact = useTgReact(salonId)
  const selected = conversations.find((c) => c.id === selectedId) ?? null

  // Auto-mark read on open (Bot или tg)
  useEffect(() => {
    if (!selectedId) return
    if (selectedIsTg && selectedTgDialogId && activeTgSession && tgMessages.length > 0) {
      // Mark up to last message id
      const lastMsg = tgMessages[tgMessages.length - 1]
      if (lastMsg) {
        tgMarkRead.mutate({
          session_id: activeTgSession.id,
          dialog_id: selectedTgDialogId,
          tg_message_id: lastMsg.tg_message_id,
        })
      }
    } else if (!selectedIsTg) {
      markRead.mutate(selectedId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedIsTg, tgMessages.length])

  if (!salonId) return null

  return (
    // Чат-страница: занимает всю доступную высоту <main> и НЕ скроллит body.
    // На мобиле: показываем либо список, либо чат (как Telegram/WhatsApp).
    // На lg+: обе колонки одновременно.
    <div className="flex h-full min-h-0 flex-1 flex-col px-3 py-3 sm:px-8 sm:py-6 lg:max-h-full">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-2 sm:mb-4 sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-brand-navy truncate text-xl font-bold tracking-tight sm:text-2xl">
            {t('messenger.title')}
          </h1>
          <p className="text-muted-foreground mt-0.5 hidden text-sm sm:mt-1 sm:block">
            {t('messenger.subtitle')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => setBulkOpen(true)}
          className="shrink-0"
        >
          <Users className="size-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t('messenger.bulk_button')}</span>
        </Button>
      </header>

      <div className="border-border bg-card shadow-finsm flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        {/* Список чатов: на мобиле hidden когда выбран чат */}
        <aside
          className={cn(
            'border-border bg-muted/10 flex-col border-r',
            selectedId ? 'hidden lg:flex' : 'flex',
            'w-full lg:w-[340px] lg:shrink-0',
          )}
        >
          {/* Search + filters */}
          <div className="border-border border-b p-2">
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
                strokeWidth={1.7}
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('messenger.search_placeholder')}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <IconChip
                label={t('messenger.all_channels')}
                active={activeChannel === null}
                color="#0F4C5C"
                onClick={() => setActiveChannel(null)}
              >
                <MessageCircle className="size-3.5" strokeWidth={2} />
              </IconChip>
              {(['telegram', 'whatsapp', 'instagram', 'facebook', 'email'] as const)
                .filter((ch) => connectedChannels.has(ch))
                .map((ch) => {
                  const meta = CHANNEL_META[ch]
                  const Icon = meta.icon
                  return (
                    <IconChip
                      key={ch}
                      label={t(meta.labelKey, { defaultValue: meta.label })}
                      active={activeChannel === ch}
                      color={meta.color}
                      onClick={() => setActiveChannel(activeChannel === ch ? null : ch)}
                      iconOnly
                    >
                      <Icon className="size-3.5" strokeWidth={2} />
                    </IconChip>
                  )
                })}
            </div>
          </div>

          {/* List */}
          <ul className="flex-1 overflow-y-auto">
            {convLoading ? (
              <li className="text-muted-foreground p-4 text-xs">{t('common.loading')}</li>
            ) : conversations.length === 0 ? (
              <li className="text-muted-foreground p-4 text-center text-xs">
                {t('messenger.empty_list')}
              </li>
            ) : (
              conversations.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  active={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))
            )}
          </ul>
        </aside>

        {/* Диалог: на мобиле hidden когда чат не выбран */}
        <div
          className={cn('min-h-0 min-w-0 flex-1 flex-col', selected ? 'flex' : 'hidden lg:flex')}
        >
          {selected ? (
            <>
              <header className="border-border bg-card flex flex-col gap-2 border-b px-3 py-2 sm:px-4 sm:py-2.5">
                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    {/* Back-кнопка на мобиле */}
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="hover:bg-muted/40 -ml-1 grid size-8 shrink-0 place-items-center rounded-md lg:hidden"
                      title={t('common.back')}
                      aria-label={t('common.back')}
                    >
                      <X className="size-5 rotate-45" strokeWidth={1.8} />
                    </button>
                    <ConversationAvatar conversation={selected} size={36} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                        <p className="text-foreground truncate text-sm font-semibold">
                          {displayNameOrFallback(selected, t('messenger.unnamed'))}
                        </p>
                        {selected.client_id ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700"
                            title={t('messenger.client_linked_tooltip')}
                          >
                            <CheckCircle2 className="size-3" strokeWidth={2.5} />
                            <span className="hidden sm:inline">{t('messenger.client_linked')}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setClientFormOpen(true)}
                            className="border-primary/40 text-primary hover:bg-primary/10 inline-flex shrink-0 items-center gap-1 rounded-full border bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                            title={t('messenger.client_unlinked_tooltip')}
                          >
                            <UserPlus className="size-3" strokeWidth={2.5} />
                            <span className="hidden sm:inline">
                              {t('messenger.client_unlinked')}
                            </span>
                          </button>
                        )}
                      </div>
                      <p className="text-muted-foreground text-[10px] sm:text-[11px]">
                        {t(CHANNEL_META[selected.channel].labelKey, {
                          defaultValue: CHANNEL_META[selected.channel].label,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* На мобиле — иконка-кнопка поиска, на десктопе — инпут */}
                    <button
                      type="button"
                      onClick={() => setMessageSearch((v) => (v === '' ? ' ' : ''))}
                      className="text-muted-foreground hover:bg-muted/40 grid size-8 shrink-0 place-items-center rounded-md sm:hidden"
                      title={t('messenger.search_in_chat')}
                      aria-label={t('messenger.search_in_chat')}
                    >
                      <Search className="size-4" strokeWidth={1.8} />
                    </button>
                    <div className="relative hidden sm:block">
                      <Search
                        className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2"
                        strokeWidth={1.7}
                      />
                      <Input
                        value={messageSearch}
                        onChange={(e) => setMessageSearch(e.target.value)}
                        placeholder={t('messenger.search_in_chat')}
                        className="h-8 w-[180px] pl-7 text-xs"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('finsalon:open-quick-entry', {
                            detail: {
                              staffId: '',
                              when: new Date().toISOString(),
                              clientId: selected.client_id ?? undefined,
                            },
                          }),
                        )
                      }}
                    >
                      <CalendarPlus className="size-4" strokeWidth={1.8} />
                      <span className="hidden sm:inline">{t('messenger.create_visit')}</span>
                    </Button>
                  </div>
                </div>
                {/* На мобиле — поиск раскрывается в отдельную строку когда есть текст */}
                {messageSearch !== '' ? (
                  <div className="relative sm:hidden">
                    <Search
                      className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2"
                      strokeWidth={1.7}
                    />
                    <Input
                      value={messageSearch}
                      onChange={(e) => setMessageSearch(e.target.value)}
                      placeholder={t('messenger.search_in_chat')}
                      className="h-8 pl-7 text-xs"
                      autoFocus
                    />
                  </div>
                ) : null}
              </header>

              <MessagesList
                messages={messages}
                onImageClick={(id) => setLightboxMessageId(id)}
                onReact={(tgMessageId, emoji) => {
                  if (selectedIsTg && selectedTgDialogId && activeTgSession) {
                    tgReact.mutate(
                      {
                        session_id: activeTgSession.id,
                        dialog_id: selectedTgDialogId,
                        tg_message_id: tgMessageId,
                        emoji,
                      },
                      {
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                      },
                    )
                  }
                }}
              />

              <Composer
                salonId={salonId}
                conversationId={selected.id}
                isTg={selectedIsTg}
                disabled={sendMessage.isPending || tgSendText.isPending || tgSendFile.isPending}
                onSendText={(text) => {
                  if (selectedIsTg && selectedTgDialogId && activeTgSession) {
                    tgSendText.mutate(
                      {
                        session_id: activeTgSession.id,
                        dialog_id: selectedTgDialogId,
                        text,
                      },
                      {
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                      },
                    )
                  } else {
                    sendMessage.mutate(
                      { conversation_id: selected.id, text },
                      {
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                      },
                    )
                  }
                }}
                onSendFile={async (file, caption) => {
                  if (selectedIsTg && selectedTgDialogId && activeTgSession) {
                    tgSendFile.mutate(
                      {
                        session_id: activeTgSession.id,
                        dialog_id: selectedTgDialogId,
                        file,
                        caption,
                      },
                      {
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                      },
                    )
                  } else {
                    try {
                      const { path, mediaKind } = await uploadMessengerMedia(
                        salonId,
                        selected.id,
                        file,
                      )
                      sendMessage.mutate(
                        {
                          conversation_id: selected.id,
                          text: caption || undefined,
                          media_path: path,
                          media_kind: mediaKind,
                        },
                        {
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : String(err)),
                        },
                      )
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e))
                    }
                  }
                }}
              />
            </>
          ) : (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <MessageCircle className="text-muted-foreground/50 size-12" strokeWidth={1.2} />
              <p className="text-sm">{t('messenger.select_chat')}</p>
            </div>
          )}
        </div>
      </div>

      <BulkBroadcastDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        salonId={salonId}
        conversations={conversations}
      />

      <MessengerLightbox
        images={imageMessages}
        openId={lightboxMessageId}
        onClose={() => setLightboxMessageId(null)}
      />

      {selected && !selected.client_id ? (
        <ClientFormModal
          open={clientFormOpen}
          onOpenChange={setClientFormOpen}
          salonId={salonId}
          prefillName={selected.display_name || ''}
          onCreated={(created) => {
            // Линкуем conversation к новому клиенту, чтобы следующий раз он
            // уже был «в базе» с пометкой ✓.
            linkClient.mutate(
              { conversationId: selected.id, clientId: created.id },
              {
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              },
            )
          }}
        />
      ) : null}
    </div>
  )
}

function IconChip({
  label,
  color,
  active,
  onClick,
  iconOnly,
  children,
}: {
  label: string
  color: string
  active: boolean
  onClick: () => void
  iconOnly?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border transition-colors',
        iconOnly ? 'size-8 justify-center' : 'px-2.5 py-1 text-[11px] font-semibold',
        active ? 'text-white' : 'text-foreground bg-card border-border hover:bg-muted/40',
      )}
      style={active ? { background: color, borderColor: color } : undefined}
    >
      {children}
      {!iconOnly ? <span>{label}</span> : null}
    </button>
  )
}

/**
 * Аватарка собеседника с channel-бейджем-углом. Если avatar_url есть —
 * показываем картинку, иначе — инициалы из display_name.
 */
function ConversationAvatar({
  conversation,
  size = 40,
}: {
  conversation: MessengerConversation
  size?: number
}) {
  const initials =
    (conversation.display_name || '?')
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  return (
    <span className="relative shrink-0">
      {conversation.avatar_url ? (
        <img
          src={conversation.avatar_url}
          alt=""
          style={{ width: size, height: size }}
          className="rounded-full object-cover"
        />
      ) : (
        <span
          style={{ width: size, height: size, fontSize: size * 0.32 }}
          className="bg-brand-teal-soft text-brand-teal-deep grid place-items-center rounded-full font-bold"
        >
          {initials}
        </span>
      )}
      <span className="absolute -bottom-0.5 -right-0.5">
        <ChannelIcon channel={conversation.channel} size={Math.max(12, Math.floor(size * 0.35))} />
      </span>
    </span>
  )
}

function ChannelIcon({ channel, size = 16 }: { channel: MessengerChannel; size?: number }) {
  const meta = CHANNEL_META[channel]
  const Icon = meta.icon
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{ background: meta.color, color: 'white', width: size + 8, height: size + 8 }}
      title={meta.label}
    >
      <Icon size={size - 4} strokeWidth={2} />
    </span>
  )
}

function ConversationRow({
  conversation,
  active,
  onSelect,
}: {
  conversation: MessengerConversation
  active: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const time = formatDistanceToNowStrict(new Date(conversation.last_message_at), {
    addSuffix: false,
    locale: getDateLocale(),
  })

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-3 border-b px-3 py-2.5 text-left transition-colors',
          active ? 'bg-primary/10' : 'hover:bg-muted/40',
          'border-border/40',
        )}
      >
        <ConversationAvatar conversation={conversation} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-foreground truncate text-sm font-semibold">
              {displayNameOrFallback(conversation, t('messenger.unnamed'))}
            </span>
            <span className="text-muted-foreground shrink-0 text-[10px]">{time}</span>
          </span>
          <span className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground line-clamp-1 text-xs">
              {conversation.last_message_preview ?? ''}
            </span>
            {conversation.unread_count > 0 ? (
              <span className="bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-5">
                {conversation.unread_count}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  )
}

function MessageBody({
  message,
  onImageClick,
}: {
  message: MessengerMessage & { _isTg?: boolean; media_pending?: boolean }
  onImageClick?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!message.media_path) {
      setMediaUrl(null)
      return
    }
    let cancelled = false
    const fetcher = message._isTg ? getTgMediaSignedUrl : getMessengerMediaUrl
    fetcher(message.media_path)
      .then((url) => {
        if (!cancelled) setMediaUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [message.media_path, message._isTg])

  // TG-lazy: медиа есть (media_kind), но ещё качается (media_path == null)
  const isLoadingMedia = !!message.media_kind && !message.media_path

  return (
    <>
      {/* Image: клик открывает lightbox (если callback передан), иначе новая вкладка */}
      {message.media_path && message.media_kind === 'image' ? (
        mediaUrl ? (
          <button type="button" onClick={() => onImageClick?.(message.id)} className="block">
            <img
              src={mediaUrl}
              alt=""
              className="mb-1 max-h-60 w-auto max-w-full rounded-md object-cover transition-opacity hover:opacity-90"
            />
          </button>
        ) : (
          <span className="text-xs italic opacity-70">📷 …</span>
        )
      ) : null}
      {/* Video — inline player. `playsInline` нужен для iOS Safari (без него
          встроенный плеер уходит в fullscreen и не показывает preview).
          Если кодек/контейнер не поддерживается браузером (IG иногда
          присылает .mov H.265), показываем кнопку «Открыть» как fallback. */}
      {message.media_path && message.media_kind === 'video' ? (
        mediaUrl ? (
          <video
            src={mediaUrl}
            controls
            playsInline
            preload="metadata"
            className="mb-1 max-h-72 w-auto max-w-full rounded-md bg-black"
          >
            <a
              href={mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs italic underline opacity-90"
            >
              {t('messenger.media.video_open', { defaultValue: '🎥 Открыть видео' })}
            </a>
          </video>
        ) : (
          <span className="text-xs italic opacity-70">🎥 …</span>
        )
      ) : null}
      {/* Voice / audio — inline player */}
      {message.media_path && message.media_kind === 'audio' ? (
        mediaUrl ? (
          <audio src={mediaUrl} controls preload="metadata" className="mb-1 max-w-full" />
        ) : (
          <span className="text-xs italic opacity-70">🎙 …</span>
        )
      ) : null}
      {/* Lazy placeholder для медиа без media_path */}
      {isLoadingMedia && message._isTg ? (
        <span className="text-xs italic opacity-70">{mediaLabel(message.media_kind!, t)} …</span>
      ) : null}
      {/* Text / caption */}
      {message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
      {/* Файл / документ / стикер — ссылка */}
      {message.media_kind &&
      message.media_path &&
      !['image', 'video', 'audio'].includes(message.media_kind) ? (
        mediaUrl ? (
          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs italic underline opacity-90"
          >
            {mediaLabel(message.media_kind, t)}
          </a>
        ) : (
          <span className="text-xs italic opacity-80">{mediaLabel(message.media_kind, t)}</span>
        )
      ) : null}
    </>
  )
}

/** Полоска реакций под сообщением (для TG). Поддерживает 5 quick-emoji
 * + просмотр существующих. Клик по существующей — toggle (снимет если уже стояла). */
const QUICK_REACTIONS = ['👍', '❤', '🔥', '😁', '😢'] as const

function ReactionsBar({
  reactions,
  onReact,
  isOut,
}: {
  reactions: { emoji: string; count: number; chosen: boolean }[] | null | undefined
  onReact: (emoji: string | null) => void
  isOut: boolean
}) {
  const [open, setOpen] = useState(false)
  const hasReactions = reactions && reactions.length > 0
  return (
    <div
      className={cn(
        'mt-1 flex flex-wrap items-center gap-1',
        isOut ? 'justify-end' : 'justify-start',
      )}
    >
      {hasReactions
        ? reactions!.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(r.chosen ? null : r.emoji)}
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors',
                r.chosen
                  ? 'border-amber-300 bg-amber-100 text-amber-900'
                  : 'border-border bg-card hover:bg-muted/50',
              )}
            >
              <span>{r.emoji}</span>
              {r.count > 1 ? <span className="font-semibold">{r.count}</span> : null}
            </button>
          ))
        : null}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded-full opacity-50 hover:opacity-100"
          title="React"
        >
          <Smile className="size-3.5" strokeWidth={1.8} />
        </button>
        {open ? (
          <div
            className={cn(
              'absolute z-20 mt-1 flex gap-1 rounded-full border bg-white p-1 shadow-md',
              isOut ? 'right-0' : 'left-0',
            )}
          >
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onReact(e)
                  setOpen(false)
                }}
                className="hover:bg-muted/40 grid size-7 place-items-center rounded-full text-base"
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function mediaLabel(
  kind: string,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  switch (kind) {
    case 'image':
      return t('messenger.media.image', { defaultValue: '📷 Изображение' })
    case 'video':
      return t('messenger.media.video', { defaultValue: '🎥 Видео' })
    case 'audio':
      return t('messenger.media.audio', { defaultValue: '🎙 Аудио' })
    case 'file':
      return t('messenger.media.file', { defaultValue: '📎 Файл' })
    case 'sticker':
      return t('messenger.media.sticker', { defaultValue: '🎭 Стикер' })
    default:
      return kind
  }
}

/** Полноэкранный просмотр изображений с перелистыванием и скачиванием. */
function MessengerLightbox({
  images,
  openId,
  onClose,
}: {
  images: Array<MessengerMessage & { _isTg?: boolean }>
  openId: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const idx = openId ? images.findIndex((m) => m.id === openId) : -1
  const [currentIdx, setCurrentIdx] = useState<number>(idx)
  const [imgUrl, setImgUrl] = useState<string | null>(null)

  // sync external openId → internal index
  useEffect(() => {
    if (idx >= 0) setCurrentIdx(idx)
  }, [idx])

  const current = currentIdx >= 0 ? images[currentIdx] : null

  // Подгрузка signed URL текущего изображения
  useEffect(() => {
    if (!current?.media_path) {
      setImgUrl(null)
      return
    }
    let cancelled = false
    const fetcher = current._isTg ? getTgMediaSignedUrl : getMessengerMediaUrl
    fetcher(current.media_path)
      .then((url) => {
        if (!cancelled) setImgUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [current])

  // Клавиатура: Esc, стрелки
  useEffect(() => {
    if (openId === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setCurrentIdx((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setCurrentIdx((i) => Math.min(images.length - 1, i + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openId, images.length, onClose])

  if (openId === null || !current) return null

  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < images.length - 1

  async function handleDownload() {
    if (!imgUrl) return
    try {
      const r = await fetch(imgUrl)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      a.download = `photo-${Date.now()}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div
        className="absolute left-0 right-0 top-0 flex items-center justify-between p-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs font-semibold opacity-80">
          {currentIdx + 1} / {images.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="grid size-9 place-items-center rounded-full transition-colors hover:bg-white/15"
            title={t('common.download', { defaultValue: 'Скачать' })}
            aria-label={t('common.download', { defaultValue: 'Скачать' })}
          >
            <Download className="size-5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full transition-colors hover:bg-white/15"
            title={t('common.close', { defaultValue: 'Закрыть' })}
            aria-label={t('common.close', { defaultValue: 'Закрыть' })}
          >
            <X className="size-5" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Prev */}
      {hasPrev ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setCurrentIdx((i) => i - 1)
          }}
          className="absolute left-3 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
          aria-label="Previous"
        >
          <ChevronLeft className="size-7" strokeWidth={1.8} />
        </button>
      ) : null}

      {/* Image */}
      <div
        className="flex max-h-[90vh] max-w-[92vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {imgUrl ? (
          <img
            key={current.id}
            src={imgUrl}
            alt=""
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
        ) : (
          <span className="text-sm text-white opacity-70">Loading…</span>
        )}
      </div>

      {/* Next */}
      {hasNext ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setCurrentIdx((i) => i + 1)
          }}
          className="absolute right-3 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
          aria-label="Next"
        >
          <ChevronRight className="size-7" strokeWidth={1.8} />
        </button>
      ) : null}

      {/* Caption */}
      {current.text ? (
        <div
          className="absolute bottom-0 left-0 right-0 max-h-[30vh] overflow-y-auto bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 text-center text-sm text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mx-auto max-w-3xl whitespace-pre-wrap break-words">{current.text}</p>
        </div>
      ) : null}
    </div>
  )
}

function MessagesList({
  messages,
  onReact,
  onImageClick,
}: {
  messages: ReturnType<typeof useConversationMessages>['data']
  onReact?: (tgMessageId: number, emoji: string | null) => void
  onImageClick?: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [messages])
  return (
    <div ref={ref} className="bg-muted/10 min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex flex-col gap-2">
        {(messages ?? []).map((m) => {
          const isTg = '_isTg' in m && (m as { _isTg?: boolean })._isTg
          const reactions = isTg
            ? (m as { reactions?: { emoji: string; count: number; chosen: boolean }[] | null })
                .reactions
            : null
          const tgMessageId = isTg ? (m as { tg_message_id?: number }).tg_message_id : undefined
          return (
            <div
              key={m.id}
              className={cn(
                'flex w-full flex-col',
                m.direction === 'out' ? 'items-end' : 'items-start',
              )}
            >
              <div
                className={cn(
                  'w-fit max-w-[75%] rounded-lg px-3 py-2 text-sm',
                  m.direction === 'out'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-foreground border-border border',
                )}
              >
                <MessageBody message={m} onImageClick={onImageClick} />
                <p
                  className={cn(
                    'mt-1 flex items-center gap-1 text-[10px] opacity-70',
                    m.direction === 'out' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <span>
                    {new Date(m.created_at).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {m.direction === 'out' && isTg ? (
                    (m as { read_by_recipient_at?: string | null }).read_by_recipient_at ? (
                      <CheckCheck className="size-3 text-sky-200" strokeWidth={2.4} />
                    ) : (
                      <Check className="size-3" strokeWidth={2.4} />
                    )
                  ) : null}
                </p>
              </div>
              {isTg && onReact && tgMessageId ? (
                <ReactionsBar
                  reactions={reactions}
                  isOut={m.direction === 'out'}
                  onReact={(emoji) => onReact(tgMessageId, emoji)}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Composer({
  disabled,
  isTg,
  onSendText,
  onSendFile,
}: {
  salonId: string
  conversationId: string
  isTg?: boolean
  disabled: boolean
  onSendText: (text: string) => void
  onSendFile: (file: File, caption?: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const voiceInputRef = useRef<HTMLInputElement>(null)
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  async function handleFile(file: File) {
    if (file.size > 50 * 1024 * 1024) {
      toast.error(t('messenger.errors.file_too_large'))
      return
    }
    setUploading(true)
    try {
      await onSendFile(file, value.trim() || undefined)
      setValue('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      for (const r of [imageInputRef, videoInputRef, fileInputRef, voiceInputRef]) {
        if (r.current) r.current.value = ''
      }
    }
  }

  async function toggleVoiceRecord() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(t('messenger.errors.no_mic'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
      const mr = new MediaRecorder(stream, { mimeType: mime })
      recordedChunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(recordedChunksRef.current, { type: mime })
        if (blob.size > 100) {
          const ext = mime.includes('ogg') ? 'ogg' : 'webm'
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime })
          await handleFile(file)
        }
        setRecording(false)
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setRecording(false)
    }
  }

  return (
    <div className="border-border bg-card flex shrink-0 items-center gap-2 border-t p-2">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <input
        ref={voiceInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <div className="relative">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground grid size-9 place-items-center rounded-md disabled:opacity-50"
          title={t('messenger.attach')}
          onClick={() => setAttachMenuOpen((v) => !v)}
          disabled={disabled || uploading}
        >
          <Plus className="size-5" strokeWidth={1.8} />
        </button>
        {attachMenuOpen ? (
          <div className="border-border absolute bottom-12 left-0 z-30 flex w-40 flex-col rounded-lg border bg-white shadow-lg">
            <AttachMenuItem
              icon={<ImageIcon className="size-4" strokeWidth={1.8} />}
              label={t('messenger.attach_image')}
              onClick={() => {
                setAttachMenuOpen(false)
                imageInputRef.current?.click()
              }}
            />
            {isTg ? (
              <>
                <AttachMenuItem
                  icon={<Play className="size-4" strokeWidth={1.8} />}
                  label={t('messenger.attach_video')}
                  onClick={() => {
                    setAttachMenuOpen(false)
                    videoInputRef.current?.click()
                  }}
                />
                <AttachMenuItem
                  icon={<Paperclip className="size-4" strokeWidth={1.8} />}
                  label={t('messenger.attach_file')}
                  onClick={() => {
                    setAttachMenuOpen(false)
                    fileInputRef.current?.click()
                  }}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {isTg ? (
        <button
          type="button"
          className={cn(
            'grid size-9 place-items-center rounded-md transition-colors disabled:opacity-50',
            recording
              ? 'animate-pulse bg-red-100 text-red-700'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title={recording ? t('messenger.stop_recording') : t('messenger.record_voice')}
          onClick={toggleVoiceRecord}
          disabled={disabled || uploading}
        >
          <Mic className="size-4" strokeWidth={1.8} />
        </button>
      ) : null}
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (value.trim()) {
              onSendText(value.trim())
              setValue('')
            }
          }
        }}
        placeholder={
          uploading
            ? t('messenger.uploading')
            : recording
              ? t('messenger.recording')
              : t('messenger.composer_placeholder')
        }
        className="h-10"
        disabled={disabled || uploading || recording}
      />
      <Button
        type="button"
        variant="primary"
        size="md"
        disabled={disabled || uploading || recording || !value.trim()}
        onClick={() => {
          if (value.trim()) {
            onSendText(value.trim())
            setValue('')
          }
        }}
      >
        <Send className="size-4" strokeWidth={1.8} />
      </Button>
    </div>
  )
}

function AttachMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/50 flex items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function BulkBroadcastDialog({
  open,
  onClose,
  salonId,
  conversations,
}: {
  open: boolean
  onClose: () => void
  salonId: string
  conversations: MessengerConversation[]
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const broadcast = useBulkBroadcast(salonId)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function send() {
    if (!text.trim()) {
      toast.error(t('messenger.bulk.errors.empty_text'))
      return
    }
    if (selected.size === 0) {
      toast.error(t('messenger.bulk.errors.no_recipients'))
      return
    }
    broadcast.mutate(
      { conversation_ids: Array.from(selected), text: text.trim() },
      {
        onSuccess: (r) => {
          toast.success(t('messenger.bulk.toast_sent', { count: r.inserted }))
          setText('')
          setSelected(new Set())
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:!max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="text-secondary size-5" strokeWidth={1.8} />
            {t('messenger.bulk.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 pb-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('messenger.bulk.placeholder')}
            rows={4}
            className="border-border bg-card rounded-md border p-3 text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {t('messenger.bulk.selected', { count: selected.size, total: conversations.length })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(new Set(conversations.map((c) => c.id)))}
              >
                {t('messenger.bulk.select_all')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
                {t('messenger.bulk.clear')}
              </Button>
            </div>
          </div>
          <ul className="max-h-[40vh] overflow-y-auto rounded-md border">
            {conversations.map((c) => (
              <li key={c.id}>
                <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="size-4"
                  />
                  <ChannelIcon channel={c.channel} size={14} />
                  <span className="flex-1 truncate">
                    {displayNameOrFallback(c, t('messenger.unnamed'))}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="size-4" strokeWidth={1.8} />
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={send} disabled={broadcast.isPending}>
            <Send className="size-4" strokeWidth={1.8} />
            {broadcast.isPending
              ? t('common.loading')
              : t('messenger.bulk.send_button', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
