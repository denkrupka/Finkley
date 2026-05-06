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
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
