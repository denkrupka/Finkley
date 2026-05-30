import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'
import sitemap from '@astrojs/sitemap'

// site = canonical origin лендинга; используется и sitemap, и для og:url/canonical
// в Layout.astro (через Astro.site).
export default defineConfig({
  site: 'https://finkley.app',
  integrations: [
    tailwind(),
    sitemap({
      // changefreq/priority дефолты — Google всё равно их игнорирует, но мы
      // ставим разумные значения для других ботов.
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      // /app/ — SPA, не индексируем. /data-deletion-status/ — служебная
      // страница для FB App Review (приватный landing после удаления),
      // не нужна в публичной выдаче.
      filter: (page) => !page.includes('/app/') && !page.includes('/data-deletion-status'),
    }),
  ],
  build: {
    // Лендинг живёт в корне gh-pages. SPA затем мерджится в подпапку /app/
    // (см. .github/workflows/deploy-web.yml — TODO в TASK-17 build merge).
    assets: '_astro',
  },
})
