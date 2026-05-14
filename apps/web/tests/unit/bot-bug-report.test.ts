/**
 * Тесты для Edge Function bot-bug-report — endpoint, куда Telegram-бот
 * пересылает баги от клиентов салонов (source='client', requires_approval=true).
 *
 * Запускается против TEST. Использует общий секрет из env BOT_WEBHOOK_SECRET_TEST.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { makeClient, SUPABASE_SERVICE, SUPABASE_URL, shouldSkip } from './_helpers'

const BOT_SECRET = process.env.BOT_WEBHOOK_SECRET_TEST || ''
const skipBot = shouldSkip || !BOT_SECRET

const createdIds: string[] = []

async function post(
  body: unknown,
  secret = BOT_SECRET,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/bot-bug-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-secret': secret },
    body: JSON.stringify(body),
  })
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>
  return { status: r.status, data }
}

describe.skipIf(skipBot)('bot-bug-report edge function', () => {
  afterEach(async () => {
    if (createdIds.length) {
      const svc = makeClient(SUPABASE_SERVICE, 'bot-cleanup')
      await svc.from('bug_reports').delete().in('id', createdIds)
      createdIds.length = 0
    }
  })

  it('creates a client bug with requires_approval=true', async () => {
    const r = await post({
      telegram_chat_id: 5_555_000 + Math.floor(Math.random() * 100_000),
      telegram_message_id: Math.floor(Math.random() * 1_000_000),
      sender_id: 42,
      sender_username: 'client_alice',
      sender_first_name: 'Alice',
      message_text: 'У меня визит не сохраняется',
      kind: 'bug',
    })
    expect(r.status).toBe(200)
    expect(r.data.ok).toBe(true)
    expect(typeof r.data.id).toBe('string')
    createdIds.push(r.data.id as string)

    const svc = makeClient(SUPABASE_SERVICE, 'bot-verify')
    const { data } = await svc
      .from('bug_reports')
      .select('source, requires_approval, status, kind, sender_username')
      .eq('id', r.data.id as string)
      .single()
    expect(data?.source).toBe('client')
    expect(data?.requires_approval).toBe(true)
    expect(data?.status).toBe('open')
    expect(data?.kind).toBe('bug')
    expect(data?.sender_username).toBe('client_alice')
  })

  it('rejects requests without secret', async () => {
    const r = await post(
      {
        telegram_chat_id: 1,
        telegram_message_id: 1,
        sender_id: 1,
        message_text: 'x',
      },
      'wrong-secret',
    )
    expect(r.status).toBe(401)
  })

  it('rejects malformed body', async () => {
    const r = await post({ telegram_chat_id: 'not-a-number' })
    expect(r.status).toBe(400)
    expect(r.data.error).toBe('missing_required_fields')
  })

  it('is idempotent: same (chat_id, message_id) returns same row', async () => {
    const chat = 7_000_000 + Math.floor(Math.random() * 100_000)
    const msg = Math.floor(Math.random() * 1_000_000)
    const body = {
      telegram_chat_id: chat,
      telegram_message_id: msg,
      sender_id: 1,
      message_text: 'dupe test',
    }
    const a = await post(body)
    const b = await post(body)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.data.id).toBe(b.data.id)
    createdIds.push(a.data.id as string)
  })
})
