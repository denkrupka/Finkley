import { Fragment, type ReactNode } from 'react'

/**
 * Парсит inline-markdown в React-ноды: `**bold**` → <strong>, `*italic*` →
 * <em>, `\n` → <br/>. LLM (Claude/Llama) часто отдают текст с разметкой,
 * а просто `{text}` в JSX показывает сырой `**bold**` со звёздочками —
 * юзер видит шум вместо выделения.
 *
 * Без зависимостей. Не парсит ссылки/код/блоки — только то что появляется
 * в коротких AI-инсайтах (1–3 предложения).
 */
export function renderMarkdownInline(text: string): ReactNode {
  if (!text) return text
  // Сначала bold (двойные звёздочки, жадно по короткому match),
  // потом italic (одиночные звёздочки). Re-using единый split-проход:
  // делим на токены через regex с захватом групп.
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|\n)/g)
  return tokens.map((tok, i) => {
    if (tok === '\n') return <br key={i} />
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      return <strong key={i}>{tok.slice(2, -2)}</strong>
    }
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2 && !tok.startsWith('**')) {
      return <em key={i}>{tok.slice(1, -1)}</em>
    }
    return <Fragment key={i}>{tok}</Fragment>
  })
}
