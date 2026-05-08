import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * RouteErrorBoundary — ловит runtime-ошибки в lazy-загруженных страницах.
 * Без него любой throw в render роняет всё дерево до белого экрана —
 * у нас был именно этот баг на /ai страницы.
 *
 * В проде показываем дружелюбный fallback с кнопкой «обновить» и
 * краткое описание ошибки (только message, не stack — секрьюрно). В dev
 * выводим stack для дебага.
 *
 * Sentry init — лениво в main.tsx, поэтому здесь не дублируем; ошибки
 * автоматически попадают туда через `Sentry.init({...})` global handler.
 */

interface Props {
  children: ReactNode
  /** Опциональный label для логов и UI: e.g. «AI-помощник». */
  label?: string
}

interface State {
  error: Error | null
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RouteErrorBoundary caught:', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      const isDev = import.meta.env.MODE !== 'production'
      return (
        <div className="flex min-h-[60vh] flex-1 items-center justify-center px-6 py-10">
          <div className="border-border bg-card shadow-finsm w-full max-w-lg rounded-lg border p-6 text-center">
            <div className="bg-destructive/10 text-destructive mx-auto mb-4 grid size-12 place-items-center rounded-full">
              <span className="text-2xl">⚠</span>
            </div>
            <h2 className="text-brand-navy mb-2 text-lg font-bold tracking-tight">
              Что-то сломалось{this.props.label ? ` на странице «${this.props.label}»` : ''}
            </h2>
            <p className="text-muted-foreground mb-4 text-sm">
              Мы уже знаем — попробуй обновить страницу. Если повторится, напиши на
              info@finkley.app.
            </p>
            {isDev ? (
              <pre className="bg-muted text-muted-foreground mb-4 max-h-40 overflow-auto rounded-md p-3 text-left text-[11px] leading-tight">
                {this.state.error.message}
                {this.state.error.stack ? '\n\n' + this.state.error.stack : ''}
              </pre>
            ) : (
              <p className="text-muted-foreground mb-4 text-xs">{this.state.error.message}</p>
            )}
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={this.reset}
                className="border-border bg-card hover:bg-muted/40 rounded-md border px-4 py-2 text-sm font-semibold"
              >
                Попробовать ещё
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold"
              >
                Перезагрузить
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
