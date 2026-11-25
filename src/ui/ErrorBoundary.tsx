import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Last-resort screen if rendering throws (SPEC §12). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Fate Table crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main id="main" tabIndex={-1} className="mx-auto flex min-h-full max-w-screen-sm flex-col justify-center gap-4 px-6 py-10">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-[color:var(--muted)]">
          The app hit an unexpected problem. Your saved changes are safe on the server; reloading usually fixes this.
        </p>
        <details className="text-sm text-[color:var(--muted)]">
          <summary className="cursor-pointer">Details</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
        </details>
        <div className="flex gap-2">
          <button type="button" onClick={() => location.reload()} className="min-h-11 rounded-xl bg-amber-700 px-5 font-medium text-white">Reload</button>
          <a href="/" className="inline-flex min-h-11 items-center rounded-xl border border-[color:var(--border)] px-5 font-medium">Home</a>
        </div>
      </main>
    )
  }
}
