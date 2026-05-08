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
          recharts: ['recharts'],
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
          // i18n — три локали уже весомые
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          // Forms — react-hook-form + zod + resolvers
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          // date-fns тяжёлый, нужен только на страницах с датами
          dates: ['date-fns'],
        },
      },
    },
  },
})
