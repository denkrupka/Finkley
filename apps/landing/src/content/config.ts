import { defineCollection, z } from 'astro:content'

/**
 * Content collection «media» — статьи блога для SEO-трафика.
 *
 * Файлы лежат в apps/landing/src/content/media/{slug}.md
 * Frontmatter: title, description, date, cover, tags, draft.
 *
 * Чтобы добавить статью — создай новый .md файл через GitHub web-interface
 * или локально. Билд лендинга автоматически подхватит её.
 *
 * Admin-UI для постинга/правки/удаления — следующий этап (TODO):
 * либо Decap CMS (Git-backed, бесплатный, OAuth через GitHub),
 * либо собственный editor в /app под role=owner с push в GitHub.
 */
const media = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    cover: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    author: z.string().optional().default('Finkley'),
    draft: z.boolean().optional().default(false),
  }),
})

export const collections = { media }
