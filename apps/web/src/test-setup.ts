import '@testing-library/jest-dom/vitest'
import { config as dotenvConfig } from 'dotenv'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import path from 'node:path'

// Загружаем .env.local в process.env — для интеграционных тестов, которым
// нужны *_TEST переменные (URL/anon/service). Vite сам грузит .env.local
// для VITE_ префикса, но process.env остаётся пустым → tests skipped.
dotenvConfig({ path: path.resolve(__dirname, '../.env.local') })

// Очистка DOM после каждого теста
afterEach(() => {
  cleanup()
})
