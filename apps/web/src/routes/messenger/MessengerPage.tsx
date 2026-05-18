import { formatDistanceToNowStrict } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  CalendarPlus,
  Check,
  CheckCheck,
  CheckCircle2,
  Facebook,
  Image as ImageIcon,
  Instagram,
  MessageCircle,
  Phone,
  Search,
  Send,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
  useTgDialogs,
  useTgMarkRead,
  useTgMessages,
  useTgRealtime,
  useTgSendPhoto,
  useTgSendText,
  type TgDialog,
  type TgMessage,
} from '@/hooks/useTgMessenger'
import { useTgSessions } from '@/hooks/useTgUserbot'
import { ClientFormModal } from '@/routes/clients/ClientFormModal'
import { cn } from '@/lib/utils/cn'

/** Адаптер TgDialog → MessengerConversation для переиспользования UI-компонентов. */
function tgDialogToConv(d: TgDialog): MessengerConversation {
  return {
    id: makeTgConvId(d.id),
    salon_id: '',
    channel: 'telegram',
    external_user_id: String(d.tg_chat_id),
    display_name: d.title || d.username || '—',
    avatar_url: null,
    client_id: null,
    unread_count: d.unread_count,
    last_message_at: d.last_message_at || new Date(0).toISOString(),
    last_message_preview: d.last_message_text,
    created_at: d.last_message_at || new Date(0).toISOString(),
    archived_at: d.archived ? new Date().toISOString() : null,
  } as unknown as MessengerConversation
}

/** Адаптер TgMessage → MessengerMessage для переиспользования MessageBody. */
function tgMessageToMsg(m: TgMessage): MessengerMessage & {
  read_by_recipient_at?: string | null
  _isTg?: true
} {
  // Маппинг media_kind: tg использует photo/video/voice/sticker/animation/document,
  // bot api использует image/video/audio/file/sticker. Конвертируем.
  const mediaKindMap: Record<string, MessengerMessage['media_kind']> = {
    photo: 'image',
    video: 'video',
    voice: 'audio',
    sticker: 'image',
    document: 'file',
    animation: 'video',
  }
  return {
    id: m.id,
    conversation_id: makeTgConvId(m.dialog_id),
    direction: m.is_outgoing ? 'out' : 'in',
    text: m.text,
    media_path: m.media_path,
    media_kind: m.media_kind ? (mediaKindMap[m.media_kind] ?? 'file') : null,
    created_at: m.sent_at,
    read_by_recipient_at: m.read_by_recipient_at,
    _isTg: true,
  } as MessengerMessage & { read_by_recipient_at?: string | null; _isTg?: true }
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
  { label: string; color: string; icon: typeof MessageCircle }
> = {
  telegram: { label: 'Telegram', color: '#229ED9', icon: Send },
  whatsapp: { label: 'WhatsApp', color: '#25D366', icon: Phone },
  instagram: { label: 'Instagram', color: '#E4405F', icon: Instagram },
  facebook: { label: 'Facebook', color: '#1877F2', icon: Facebook },
  internal: { label: 'Внутренний', color: '#6B7280', icon: MessageCircle },
}

export function MessengerPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [activeChannel, setActiveChannel] = useState<MessengerChannel | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [clientFormOpen, setClientFormOpen] = useState(false)
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

  // Объединённый список: Bot API без telegram + tg_dialogs как telegram
  const conversations = useMemo(() => {
    const filtered = botConversations.filter((c) => c.channel !== 'telegram')
    const tgConvs = tgDialogs.map(tgDialogToConv).filter((c) => {
      if (activeChannel && activeChannel !== 'telegram') return false
      if (search && !c.display_name?.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    // Объединяем + сортируем по last_message_at desc
    return [...filtered, ...tgConvs].sort(
      (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
    )
  }, [botConversations, tgDialogs, activeChannel, search])

  const selectedIsTg = isTgConvId(selectedId)
  const selectedTgDialogId = selectedIsTg ? parseTgConvId(selectedId!) : null

  // Сообщения: либо Bot API, либо tg_messages
  const { data: botMessages = [] } = useConversationMessages(
    !selectedIsTg && selectedId ? selectedId : undefined,
  )
  const { data: tgMessages = [] } = useTgMessages(selectedTgDialogId ?? undefined)
  const messages = useMemo(
    () => (selectedIsTg ? tgMessages.map(tgMessageToMsg) : botMessages),
    [selectedIsTg, botMessages, tgMessages],
  )

  const sendMessage = useSendMessage(salonId)
  const markRead = useMarkConversationRead(salonId)
  const tgSendText = useTgSendText(salonId)
  const tgSendPhoto = useTgSendPhoto(salonId)
  const tgMarkRead = useTgMarkRead()
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
    // sticky=true на родителе <main> (overflow-y-auto на lg) — на десктопе
    // мы фактически забираем у main внешний скролл и держим всё внутри
    // высоты viewport. На мобильном падаем на обычный flex-grow.
    <div className="flex h-full min-h-0 flex-1 flex-col px-5 py-6 sm:px-8 lg:max-h-full">
      <header className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('messenger.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('messenger.subtitle')}</p>
        </div>
        <Button variant="secondary" size="md" onClick={() => setBulkOpen(true)}>
          <Users className="size-4" strokeWidth={1.8} />
          {t('messenger.bulk_button')}
        </Button>
      </header>

      <div className="border-border bg-card shadow-finsm flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        {/* Список чатов */}
        <aside className="border-border bg-muted/10 flex w-[340px] shrink-0 flex-col border-r">
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
              {(['telegram', 'whatsapp', 'instagram', 'facebook'] as const).map((ch) => {
                const meta = CHANNEL_META[ch]
                const Icon = meta.icon
                return (
                  <IconChip
                    key={ch}
                    label={meta.label}
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

        {/* Диалог */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <header className="border-border bg-card flex items-center justify-between gap-3 border-b px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <ConversationAvatar conversation={selected} size={36} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {selected.display_name || t('messenger.unnamed')}
                      </p>
                      {selected.client_id ? (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700"
                          title={t('messenger.client_linked_tooltip')}
                        >
                          <CheckCircle2 className="size-3" strokeWidth={2.5} />
                          {t('messenger.client_linked')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setClientFormOpen(true)}
                          className="border-primary/40 text-primary hover:bg-primary/10 inline-flex shrink-0 items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                          title={t('messenger.client_unlinked_tooltip')}
                        >
                          <UserPlus className="size-3" strokeWidth={2.5} />
                          {t('messenger.client_unlinked')}
                        </button>
                      )}
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      {CHANNEL_META[selected.channel].label}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
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
                    {t('messenger.create_visit')}
                  </Button>
                </div>
              </header>

              <MessagesList messages={messages} />

              <Composer
                salonId={salonId}
                conversationId={selected.id}
                isTg={selectedIsTg}
                disabled={sendMessage.isPending || tgSendText.isPending || tgSendPhoto.isPending}
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
                onSendPhoto={async (file, caption) => {
                  if (selectedIsTg && selectedTgDialogId && activeTgSession) {
                    tgSendPhoto.mutate(
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
  const time = formatDistanceToNowStrict(new Date(conversation.last_message_at), {
    addSuffix: false,
    locale: ru,
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
              {conversation.display_name || '—'}
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

function MessageBody({ message }: { message: MessengerMessage & { _isTg?: boolean } }) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!message.media_path) return
    let cancelled = false
    const fetcher = message._isTg ? getTgMediaSignedUrl : getMessengerMediaUrl
    fetcher(message.media_path).then((url) => {
      if (!cancelled) setMediaUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [message.media_path, message._isTg])

  return (
    <>
      {message.media_path && message.media_kind === 'image' ? (
        mediaUrl ? (
          <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={mediaUrl}
              alt=""
              className="mb-1 max-h-60 w-auto max-w-full rounded-md object-cover"
            />
          </a>
        ) : (
          <span className="text-xs italic opacity-70">📷 …</span>
        )
      ) : null}
      {message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
      {message.media_kind && !message.text && message.media_kind !== 'image' ? (
        mediaUrl ? (
          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs italic underline opacity-90"
          >
            {mediaLabel(message.media_kind)}
          </a>
        ) : (
          <span className="text-xs italic opacity-80">{mediaLabel(message.media_kind)}</span>
        )
      ) : null}
    </>
  )
}

function mediaLabel(kind: string): string {
  switch (kind) {
    case 'image':
      return '📷 Изображение'
    case 'video':
      return '🎥 Видео'
    case 'audio':
      return '🎙 Аудио'
    case 'file':
      return '📎 Файл'
    case 'sticker':
      return '🎭 Стикер'
    default:
      return kind
  }
}

function MessagesList({
  messages,
}: {
  messages: ReturnType<typeof useConversationMessages>['data']
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [messages])
  return (
    <div ref={ref} className="bg-muted/10 min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex flex-col gap-2">
        {(messages ?? []).map((m) => (
          <div
            key={m.id}
            className={cn(
              'w-fit max-w-[75%] rounded-lg px-3 py-2 text-sm',
              m.direction === 'out'
                ? 'bg-primary text-primary-foreground self-end'
                : 'bg-card text-foreground border-border self-start border',
            )}
          >
            <MessageBody message={m} />
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
              {/* Read receipts: ✓ = доставлено, ✓✓ = прочитано (для outgoing TG) */}
              {m.direction === 'out' && '_isTg' in m && (m as { _isTg?: boolean })._isTg ? (
                (m as { read_by_recipient_at?: string | null }).read_by_recipient_at ? (
                  <CheckCheck className="size-3 text-sky-200" strokeWidth={2.4} />
                ) : (
                  <Check className="size-3" strokeWidth={2.4} />
                )
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Composer({
  disabled,
  onSendText,
  onSendPhoto,
}: {
  salonId: string
  conversationId: string
  isTg?: boolean
  disabled: boolean
  onSendText: (text: string) => void
  onSendPhoto: (file: File, caption?: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      toast.error(t('messenger.errors.file_too_large'))
      return
    }
    setUploading(true)
    try {
      await onSendPhoto(file, value.trim() || undefined)
      setValue('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="border-border bg-card flex shrink-0 items-center gap-2 border-t p-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground grid size-9 place-items-center rounded-md disabled:opacity-50"
        title={t('messenger.attach_image')}
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
      >
        <ImageIcon className="size-4" strokeWidth={1.8} />
      </button>
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
        placeholder={uploading ? t('messenger.uploading') : t('messenger.composer_placeholder')}
        className="h-10"
        disabled={disabled || uploading}
      />
      <Button
        type="button"
        variant="primary"
        size="md"
        disabled={disabled || uploading || !value.trim()}
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
                  <span className="flex-1 truncate">{c.display_name}</span>
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
