import {
  AlertCircle,
  ArrowLeftRight,
  Bot,
  Check,
  Loader2,
  Receipt,
  RotateCcw,
  Send,
  Sparkles,
  User,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  useAIHistory,
  useAISuggestions,
  useResetAIChat,
  useSendAIMessage,
  useUndoToolCall,
  type AIToolCall,
} from '@/hooks/useAIAssistant'
import { cn } from '@/lib/utils/cn'

export function AIAssistantPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data, isLoading } = useAIHistory(salonId)
  const { data: suggestions } = useAISuggestions(salonId)
  const sendMsg = useSendAIMessage(salonId)
  const reset = useResetAIChat(salonId)
  const undo = useUndoToolCall(salonId)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Группируем tool_calls по message_id для быстрого lookup
  const toolCallsByMessage = useMemo(() => {
    const m = new Map<string, AIToolCall[]>()
    for (const tc of data?.tool_calls ?? []) {
      const list = m.get(tc.message_id) ?? []
      list.push(tc)
      m.set(tc.message_id, list)
    }
    return m
  }, [data?.tool_calls])

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

  // Префилл prompt из AiInsightsPanel («Что с этим делать?»): sessionStorage.
  const consumedPrefillRef = useRef(false)
  useEffect(() => {
    if (consumedPrefillRef.current) return
    if (isLoading) return
    let prefill: string | null = null
    try {
      prefill = window.sessionStorage.getItem('finkley:ai-prefill-prompt')
      if (prefill) window.sessionStorage.removeItem('finkley:ai-prefill-prompt')
    } catch {
      // ignore
    }
    if (!prefill) return
    consumedPrefillRef.current = true
    send(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const messages = data?.messages ?? []
  const isEmpty = !isLoading && messages.length === 0
  // Скрываем пресеты ПОСЛЕ первого сообщения юзера, чтобы чат был чище.
  const hasUserMessage = messages.some((m) => m.role === 'user')
  const showQuickActions = !isLoading && !hasUserMessage && !sendMsg.isPending

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
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {isLoading ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              <Loader2 className="mr-2 size-4 animate-spin" strokeWidth={2} />
              {t('common.loading')}
            </div>
          ) : isEmpty ? (
            <EmptyState suggestions={suggestions ?? []} onPick={(prompt) => send(prompt)} />
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <div key={m.id}>
                  <MessageBubble role={m.role} content={m.content} />
                  {/* Inline tool-call карточки под сообщением ассистента */}
                  {m.role === 'assistant' && toolCallsByMessage.has(m.id) ? (
                    <div className="ml-9 mt-2 flex flex-col gap-1.5">
                      {toolCallsByMessage.get(m.id)!.map((tc) => (
                        <ToolCallCard
                          key={tc.id}
                          tc={tc}
                          onUndo={() =>
                            undo.mutate(tc.id, {
                              onError: (e) =>
                                toast.error(e instanceof Error ? e.message : String(e)),
                              onSuccess: () => toast.success(t('ai.tool_undone')),
                            })
                          }
                          undoing={undo.isPending}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {sendMsg.isPending ? <MessageBubble role="assistant" content="" pending /> : null}
            </div>
          )}
        </div>

        {showQuickActions ? <QuickActions onPick={(prompt) => send(prompt)} /> : null}

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

/**
 * Быстрые пресеты-подсказки над input chat. Клик отправляет готовый prompt,
 * который AI понимает и зовёт соответствующий tool с уточнениями параметров.
 * На мобиле — horizontal scroll, на десктопе — grid-cols-4.
 * Видны только пока юзер не отправил первое сообщение (см. showQuickActions).
 */
function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useTranslation()
  const items: { key: string; emoji: string; label: string; prompt: string }[] = [
    {
      key: 'add_visit',
      emoji: '💰',
      label: t('ai.quick_actions.add_visit'),
      prompt: t('ai.quick_actions.prompt_add_visit'),
    },
    {
      key: 'add_expense',
      emoji: '📉',
      label: t('ai.quick_actions.add_expense'),
      prompt: t('ai.quick_actions.prompt_add_expense'),
    },
    {
      key: 'transfer_cash',
      emoji: '🔁',
      label: t('ai.quick_actions.transfer_cash'),
      prompt: t('ai.quick_actions.prompt_transfer_cash'),
    },
    {
      key: 'close_payroll',
      emoji: '📋',
      label: t('ai.quick_actions.close_payroll'),
      prompt: t('ai.quick_actions.prompt_close_payroll'),
    },
  ]
  return (
    <div className="border-border border-t bg-white px-3 py-2.5 sm:px-4">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-2 sm:overflow-visible sm:px-0">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onPick(item.prompt)}
            className="border-border bg-card hover:border-secondary hover:bg-secondary/5 flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:shrink sm:justify-center sm:py-2"
          >
            <span aria-hidden>{item.emoji}</span>
            <span className="whitespace-nowrap sm:whitespace-normal sm:text-center">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function EmptyState({
  suggestions,
  onPick,
}: {
  suggestions: { prompt: string; reason?: string }[]
  onPick: (prompt: string) => void
}) {
  const { t } = useTranslation()
  // Fallback на статичные подсказки если динамические ещё не загрузились.
  const staticFallback = [
    t('ai.suggestions.revenue_this_month'),
    t('ai.suggestions.top_master'),
    t('ai.suggestions.compare_prev'),
    t('ai.suggestions.what_to_improve'),
  ]
  const items = suggestions.length > 0 ? suggestions.map((s) => s.prompt) : staticFallback
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
        {items.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="border-border bg-card hover:border-secondary hover:bg-secondary/5 rounded-md border px-3 py-2 text-left text-sm transition-colors"
          >
            {prompt}
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

const TOOL_ICONS: Record<string, typeof Receipt> = {
  create_visit: Receipt,
  create_expense: Receipt,
  create_client: UserPlus,
  create_service: Wrench,
  transfer_cash: ArrowLeftRight,
}

function ToolCallCard({
  tc,
  onUndo,
  undoing,
}: {
  tc: AIToolCall
  onUndo: () => void
  undoing: boolean
}) {
  const { t } = useTranslation()
  const Icon = TOOL_ICONS[tc.tool_name] ?? Sparkles
  const isError = tc.status === 'error'
  const isUndone = tc.status === 'undone' || tc.undone_at !== null
  const canUndo = tc.status === 'success' && !isUndone && !!tc.entity_id

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs',
        isError
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : isUndone
            ? 'border-border bg-muted/30 text-muted-foreground'
            : 'border-emerald-200 bg-emerald-50/60 text-emerald-900',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
          isError
            ? 'bg-destructive/20'
            : isUndone
              ? 'bg-muted-foreground/20'
              : 'bg-emerald-200/70 text-emerald-700',
        )}
        aria-hidden
      >
        {isError ? (
          <AlertCircle className="size-3" strokeWidth={2} />
        ) : isUndone ? (
          <X className="size-3" strokeWidth={2.2} />
        ) : (
          <Check className="size-3" strokeWidth={2.5} />
        )}
      </span>
      <div className="flex-1 leading-snug">
        <div className="flex items-center gap-1.5 font-bold">
          <Icon className="size-3.5" strokeWidth={1.8} />
          <span>{t(`ai.tools.${tc.tool_name}`, { defaultValue: tc.tool_name })}</span>
        </div>
        <div className="mt-0.5">
          {isError ? (tc.error_message ?? t('ai.tool_error_generic')) : (tc.result_summary ?? '—')}
          {isUndone ? ` · ${t('ai.tool_status_undone')}` : null}
        </div>
      </div>
      {canUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={undoing}
          className="text-muted-foreground hover:text-foreground shrink-0 self-center text-[11px] underline-offset-2 hover:underline disabled:opacity-50"
        >
          {undoing ? <Loader2 className="size-3 animate-spin" strokeWidth={2} /> : t('ai.undo')}
        </button>
      ) : null}
    </div>
  )
}
