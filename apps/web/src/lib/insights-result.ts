/**
 * T226 — pure helper для интерпретации generate-insights ответа.
 *
 * Edge function возвращает { ok: true, mode: 'manual', generated: N }.
 * Выделено в отдельный helper чтобы юнит-тестировать поведение
 * runAiAnalysis без мока supabase client'а.
 */

export type InsightsResult = {
  ok?: boolean
  generated?: number
} | null

export type RunAiAnalysisOutcome = 'success' | 'no_data' | 'error'

export function interpretInsightsResult(
  result: InsightsResult,
  error?: { message?: string } | null,
): RunAiAnalysisOutcome {
  if (error) return 'error'
  if (!result) return 'error'
  if (result.generated === 0) return 'no_data'
  if (typeof result.generated === 'number' && result.generated > 0) return 'success'
  return 'error'
}
