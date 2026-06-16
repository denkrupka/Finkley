import { useMutation } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * SEO-помощник для админки блога — генерирует title/description/keywords/outline
 * и улучшает текст через Claude. Edge function ai-seo-helper.
 */
async function callAi<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('not_authenticated')
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const r = await fetch(`${baseUrl}/functions/v1/ai-seo-helper?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `HTTP ${r.status}`)
  }
  return (await r.json()) as T
}

export function useAiGenerateTitle() {
  return useMutation({
    mutationFn: (vars: { body_html: string; target_keyword?: string }) =>
      callAi<{ titles: string[] }>('generate_title', vars),
  })
}

export function useAiGenerateDescription() {
  return useMutation({
    mutationFn: (vars: { title: string; body_html: string }) =>
      callAi<{ description: string }>('generate_description', vars),
  })
}

export function useAiGenerateKeywords() {
  return useMutation({
    mutationFn: (vars: { title: string; body_html: string }) =>
      callAi<{ keywords: string[] }>('generate_keywords', vars),
  })
}

export function useAiGenerateOutline() {
  return useMutation({
    mutationFn: (vars: { title: string; target_keyword?: string }) =>
      callAi<{ outline: string }>('generate_outline', vars),
  })
}

export function useAiImproveText() {
  return useMutation({
    mutationFn: (vars: { text: string; instruction?: string }) =>
      callAi<{ improved: string }>('improve_text', vars),
  })
}

export function useAiSuggestTopics() {
  return useMutation({
    mutationFn: (vars: { target_keyword: string }) =>
      callAi<{ topics: string[] }>('suggest_topics', vars),
  })
}

export type FullArticle = {
  title: string
  seo_title: string
  description: string
  seo_description: string
  slug: string
  keywords: string[]
  tags: string[]
  body_html: string
}

/** Полная генерация статьи одним кликом (заголовок, slug, мета, ключи, теги,
 *  тело) под максимальный SEO score. Обложку и ссылки добивает клиент. */
export function useAiGenerateFullArticle() {
  return useMutation({
    mutationFn: (vars: { target_keyword: string; title?: string }) =>
      callAi<FullArticle>('generate_full_article', vars),
  })
}
