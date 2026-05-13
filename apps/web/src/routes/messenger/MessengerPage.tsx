import { formatDistanceToNowStrict } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  CalendarPlus,
  Facebook,
  Image as ImageIcon,
  Instagram,
  MessageCircle,
  Phone,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  useMarkConversationRead,
  useMessengerRealtime,
  useSendMessage,
  uploadMessengerMedia,
  type MessengerChannel,
  type MessengerConversation,
  type MessengerMessage,
} from '@/hooks/useMessenger'
import { cn } from '@/lib/utils/cn'

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

  useMessengerRealtime(salonId)
  const { data: conversations = [], isLoading: convLoading } = useConversations(salonId, {
    channel: activeChannel,
    search,
  })
  const { data: messages = [] } = useConversationMessages(selectedId ?? undefined)
  const sendMessage = useSendMessage(salonId)
  const markRead = useMarkConversationRead(salonId)
  const selected = conversations.find((c) => c.id === selectedId) ?? null

  // Auto-mark read on open
  useEffect(() => {
    if (selectedId) markRead.mutate(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  if (!salonId) return null

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-1 flex-col px-5 py-6 sm:px-8">
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
                  <ChannelIcon channel={selected.channel} size={20} />
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-semibold">
                      {selected.display_name || t('messenger.unnamed')}
                    </p>
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
                disabled={sendMessage.isPending}
                onSend={(text, mediaPath, mediaKind) =>
                  sendMessage.mutate(
                    {
                      conversation_id: selected.id,
                      text: text || undefined,
                      media_path: mediaPath,
                      media_kind: mediaKind,
                    },
                    {
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : String(err)),
                    },
                  )
                }
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
  const initials = (conversation.display_name || '?')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
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
        <span className="relative">
          {conversation.avatar_url ? (
            <img
              src={conversation.avatar_url}
              alt=""
              className="size-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="bg-brand-teal-soft text-brand-teal-deep grid size-10 shrink-0 place-items-center rounded-full text-xs font-bold">
              {initials || '?'}
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5">
            <ChannelIcon channel={conversation.channel} size={14} />
          </span>
        </span>
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

function MessageBody({ message }: { message: MessengerMessage }) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!message.media_path) return
    let cancelled = false
    getMessengerMediaUrl(message.media_path).then((url) => {
      if (!cancelled) setMediaUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [message.media_path])

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
                'mt-1 text-[10px] opacity-70',
                m.direction === 'out' ? 'text-right' : 'text-left',
              )}
            >
              {new Date(m.created_at).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Composer({
  salonId,
  conversationId,
  disabled,
  onSend,
}: {
  salonId: string
  conversationId: string
  disabled: boolean
  onSend: (
    text: string,
    mediaPath?: string,
    mediaKind?: 'image' | 'video' | 'audio' | 'file',
  ) => void
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
      const { path, mediaKind } = await uploadMessengerMedia(salonId, conversationId, file)
      onSend('', path, mediaKind)
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
        accept="image/*,video/*,audio/*,.pdf"
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
              onSend(value.trim())
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
            onSend(value.trim())
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
