import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Загружаем .env.local чтобы Playwright-тесты видели VITE_SUPABASE_* и
// SUPABASE_SERVICE_ROLE_KEY (для admin API в beforeEach/afterEach).
// Vite уже читает .env.local в dev-сервере, но Node-процесс Playwright нет.
loadEnv({ path: '.env.local' })

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // RU — единственная полная локаль приложения. Playwright Chrome по
    // умолчанию ставит navigator.language=en-US, из-за чего i18n-detector
    // отдаёт неполные EN-переводы и тесты, ожидающие RU-текст, падают.
    locale: 'ru-RU',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.CI
    ? {
        // В CI приложение уже собрано (pnpm build с TEST-env, см. ci.yml e2e job),
        // поднимаем статику через vite preview. Раньше здесь было `undefined` —
        // сервер не стартовал, и ВСЕ тесты падали с net::ERR_CONNECTION_REFUSED.
        command: 'pnpm exec vite preview --port 5173 --strictPort',
        url: 'http://localhost:5173',
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        // Если dev server уже работает на MAIN env — он остаётся и тесты
        // обязаны создавать юзеров в MAIN (см. admin-flow.spec.ts).
        // Если переустанавливать — Playwright перезапустит с TEST env через
        // переменные ниже, тогда юзеры в TEST совпадут с dev server.
        reuseExistingServer: true,
        timeout: 60_000,
        env: {
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL_TEST ?? '',
          VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY_TEST ?? '',
        },
      },
})
