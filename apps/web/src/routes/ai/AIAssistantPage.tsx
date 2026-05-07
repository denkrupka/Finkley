import { Bot, Loader2, RotateCcw, Send, Sparkles, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useAIHistory, useResetAIChat, useSendAIMessage } from '@/hooks/useAIAssistant'
import { cn } from '@/lib/utils/cn'

const SUGGESTIONS = [
  'ai.suggestions.revenue_this_month',
  'ai.suggestions.top_master',
  'ai.suggestions.compare_prev',
  'ai.suggestions.what_to_improve',
] as const

export function AIAssistantPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data, isLoading } = useAIHistory(salonId)
  const sendMsg = useSendAIMessage(salonId)
  const reset = useResetAIChat(salonId)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Автоскролл вниз при новом сообщении
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [data?.messages.length, sendMsg.isPending])

  function send(text: string) {
    const message = text.trim()
    if (!message || sendMsg.isPending) return
    setInput('')
    sendMsg.mutate(
      { message, conversationId: data?.conversation_id ?? undefined },
      {
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const messages = data?.messages ?? []
  const isEmpty = !isLoading && messages.length === 0

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-8">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-brand-navy flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span
              className="bg-brand-teal-soft text-brand-teal-deep grid size-8 place-items-center rounded-lg"
              aria-hidden
            >
              <Sparkles className="size-4" strokeWidth={2} />
            </span>
            {t('ai.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('ai.subtitle')}</p>
        </div>
        {messages.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!confirm(t('ai.confirm_reset'))) return
              reset.mutate()
            }}
            disabled={reset.isPending}
          >
            <RotateCcw className="size-3.5" strokeWidth={1.7} />
            {t('ai.new_chat')}
          </Button>
        ) : null}
      </div>

      {/* Body */}
      <div className="border-border bg-card shadow-finsm flex min-h-0 flex-1 flex-col rounded-lg border">
        {/* Сообщения */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {isLoading ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              <Loader2 className="mr-2 size-4 animate-spin" strokeWidth={2} />
              {t('common.loading')}
            </div>
          ) : isEmpty ? (
            <EmptyState onPick={(key) => send(t(key))} />
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} />
              ))}
              {sendMsg.isPending ? <MessageBubble role="assistant" content="" pending /> : null}
            </div>
          )}
        </div>

        {/* Input */}
        <form
          className="border-border flex items-end gap-2 border-t bg-white px-3 py-3 sm:px-4"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ai.input_placeholder')}
            rows={1}
            disabled={sendMsg.isPending}
            className="border-border bg-background placeholder:text-muted-foreground/60 focus:border-secondary focus:ring-secondary/20 max-h-32 min-h-10 flex-1 resize-none rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-60"
          />
          <Button
            type="submit"
            size="md"
            disabled={!input.trim() || sendMsg.isPending}
            className="h-10 shrink-0"
          >
            {sendMsg.isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <Send className="size-4" strokeWidth={1.9} />
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (key: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-12 text-center">
      <span
        className="bg-brand-teal-soft text-brand-teal-deep grid size-14 place-items-center rounded-2xl"
        aria-hidden
      >
        <Bot className="size-7" strokeWidth={1.7} />
      </span>
      <div>
        <h2 className="text-brand-navy text-lg font-bold">{t('ai.empty_title')}</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-snug">{t('ai.empty_subtitle')}</p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          {t('ai.suggestions_label')}
        </p>
        {SUGGESTIONS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            className="border-border bg-card hover:border-secondary hover:bg-secondary/5 rounded-md border px-3 py-2 text-left text-sm transition-colors"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({
  role,
  content,
  pending,
}: {
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser ? (
        <span
          className="bg-brand-teal-soft text-brand-teal-deep mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
          aria-hidden
        >
          <Bot className="size-4" strokeWidth={1.7} />
        </span>
      ) : null}
      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[640px]',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted/50 text-foreground rounded-tl-sm',
        )}
      >
        {pending ? (
          <span className="inline-flex items-center gap-2 opacity-70">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            <span className="text-xs">…</span>
          </span>
        ) : (
          <span className="whitespace-pre-wrap">{content}</span>
        )}
      </div>
      {isUser ? (
        <span
          className="bg-secondary/20 text-secondary mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
          aria-hidden
        >
          <User className="size-4" strokeWidth={1.7} />
        </span>
      ) : null}
    </div>
  )
}
