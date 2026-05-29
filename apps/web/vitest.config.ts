import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/unit/**/*.{test,spec}.{ts,tsx}',
      // T49 — pure-логика Edge Function shared-helpers (без Deno API).
      '../../supabase/functions/_shared/**/*.{test,spec}.ts',
      // I4 — pure-логика send-email/templates (pickTemplate, render, normalize).
      '../../supabase/functions/send-email/*.{test,spec}.ts',
    ],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    // RPC/edge-function тесты ходят в реальный Supabase staging — иногда
    // флапают на rate-limit или конкуренции (admin-stats особенно). Даём
    // 2 ретрая на flaky-кейсы, не маскирующих реальные регрессии.
    retry: 2,
    // Сериализуем выполнение test-файлов (но внутри файла it'ы остаются
    // параллельными). Параллельный запуск нескольких файлов конкурирует
    // за один и тот же staging Supabase — bank_tx_splits ловит timeout
    // и RLS-тесты видят чужие seeds. Чуть медленнее, но стабильнее.
    fileParallelism: false,
    // Default 5s слишком короткий для PostgREST RPC через сеть. UNIQUE-тест
    // bank_tx_splits надёжно занимает 14-15s (insert + дубль). Поднимаем.
    testTimeout: 20_000,
  },
})
