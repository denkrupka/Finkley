import { Fragment, type ReactNode } from 'react'

/**
 * Парсит inline-markdown в React-ноды:
 *   **bold** / __bold__   → <strong>
 *   *italic* / _italic_   → <em>
 *   \n                    → <br/>
 *
 * LLM (Claude/Llama/Mistral) часто отдают текст с разметкой; без парсера
 * юзер видит сырой `**bold**` со звёздочками.
 *
 * Без зависимостей, без HTML-инъекций (только string-токены попадают в
 * текст-ноды React, который сам эскейпит). Не парсит ссылки/код-блоки —
 * только то что попадается в коротких AI-инсайтах (1–3 предложения).
 *
 * Контракт (pure, тестируется через `tests/unit/render-markdown-inline.test.tsx`):
 *   renderMarkdownInline('a **b** c')      → ['a ', <strong>b</strong>, ' c']
 *   renderMarkdownInline('x __y__ z')      → ['x ', <strong>y</strong>, ' z']
 *   renderMarkdownInline('q *r* s')        → ['q ', <em>r</em>, ' s']
 *   renderMarkdownInline('p _t_ u')        → ['p ', <em>t</em>, ' u']
 *   renderMarkdownInline('A\nB')           → ['A', <br/>, 'B']
 *   renderMarkdownInline('')               → ''
 *   renderMarkdownInline('plain')          → 'plain' (one token)
 */
export function renderMarkdownInline(text: string): ReactNode {
  if (!text) return text
  // Жадный split по всем известным токенам. Порядок матчей в regex важен:
  // **bold** и __bold__ должны идти РАНЬШЕ *italic*/_italic_, иначе одиночные
  // звёздочки/подчёркивания «съедят» границы bold-блока.
  const tokens = text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\n)/g)
  return tokens.map((tok, i) => {
    if (tok === '\n') return <br key={i} />
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      return <strong key={i}>{tok.slice(2, -2)}</strong>
    }
    if (tok.startsWith('__') && tok.endsWith('__') && tok.length > 4) {
      return <strong key={i}>{tok.slice(2, -2)}</strong>
    }
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2 && !tok.startsWith('**')) {
      return <em key={i}>{tok.slice(1, -1)}</em>
    }
    if (tok.startsWith('_') && tok.endsWith('_') && tok.length > 2 && !tok.startsWith('__')) {
      return <em key={i}>{tok.slice(1, -1)}</em>
    }
    return <Fragment key={i}>{tok}</Fragment>
  })
}
