import { Globe } from 'lucide-react'

/**
 * Превью как статья будет выглядеть в поиске Google и в share-карточке
 * соцсетей (OG card). Помогает увидеть title/description/url в контексте.
 */
export function GoogleSnippetPreview({
  title,
  description,
  slug,
  cover_url,
}: {
  title: string
  description: string
  slug: string
  cover_url?: string | null
}) {
  const url = `finkley.app › media › ${slug || '...'}`
  const displayTitle = title || 'Заголовок появится здесь'
  const displayDesc =
    description ||
    'Описание появится здесь. Это первое, что увидят люди в результатах поиска и при шаринге в соцсетях.'

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
          В поиске Google
        </h3>
        <div className="border-border bg-card rounded-lg border p-4">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <div className="bg-muted/40 grid size-4 place-items-center rounded-full">
              <Globe className="size-2.5" strokeWidth={2} />
            </div>
            <span>finkley.app</span>
            <span>›</span>
            <span className="truncate">{url.split('›').slice(-1)[0]}</span>
          </div>
          <h4 className="mt-1 text-lg text-[#1a0dab] underline-offset-2 hover:underline">
            {displayTitle.length > 60 ? displayTitle.slice(0, 57) + '…' : displayTitle}
          </h4>
          <p className="mt-1 text-sm leading-snug text-slate-700">
            {displayDesc.length > 160 ? displayDesc.slice(0, 157) + '…' : displayDesc}
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
          В соцсетях (OG card)
        </h3>
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          {cover_url ? (
            <img src={cover_url} alt="OG preview" className="aspect-[1.91/1] w-full object-cover" />
          ) : (
            <div className="bg-muted/40 text-muted-foreground flex aspect-[1.91/1] w-full items-center justify-center text-xs">
              Нет обложки
            </div>
          )}
          <div className="border-border border-t p-3">
            <p className="text-muted-foreground text-[10px] uppercase">finkley.app</p>
            <p className="text-foreground mt-0.5 line-clamp-1 text-sm font-semibold">
              {displayTitle}
            </p>
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{displayDesc}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
