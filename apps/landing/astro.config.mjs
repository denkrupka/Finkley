import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'

export default defineConfig({
  site: 'https://finkley.app',
  integrations: [tailwind()],
  build: {
    // Лендинг живёт в корне gh-pages. SPA затем мерджится в подпапку /app/
    // (см. .github/workflows/deploy-web.yml — TODO в TASK-17 build merge).
    assets: '_astro',
  },
})
