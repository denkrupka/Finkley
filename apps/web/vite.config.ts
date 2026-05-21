import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
//
// `base` определяет публичный путь префикса. Локально dev/preview работает
// на `/`, в проде SPA живёт в подпапке `/app/` (рядом с лендингом на корне).
// Передаётся через env `VITE_BASE` из CI (см. .github/workflows/deploy-web.yml).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          // Heavy UI vendors — отдельный chunk, ленится через lazy-routes
          'ui-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-switch',
            '@radix-ui/react-label',
            '@radix-ui/react-slot',
          ],
          // TanStack Query — используется во всех страницах через хуки,
          // выносим в отдельный chunk чтобы не тянулся в initial bundle.
          'react-query': ['@tanstack/react-query'],
          // Toast — sonner ~12KB, в отдельный chunk чтобы не блокировал критический путь
          sonner: ['sonner'],
          // i18n — три локали уже весомые
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          // Forms — react-hook-form + zod + resolvers
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          // date-fns тяжёлый, нужен только на страницах с датами
          dates: ['date-fns'],
          // recharts ~377KB — отдельный chunk. Page-chunks типа ReportsHub/
          // Dashboard теперь не несут recharts inline. Lazy-routes триггерят
          // загрузку только при первом открытии страницы с графиками.
          recharts: ['recharts'],
        },
      },
    },
  },
})
