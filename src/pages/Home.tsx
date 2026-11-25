import { useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { ensureAnonymousUser, isConfigured, supabase } from '../lib/supabase.ts'

type Status =
  | { kind: 'checking' }
  | { kind: 'not_configured' }
  | { kind: 'error'; message: string }
  | { kind: 'connected'; uid: string; db: 'ok' | 'missing' | string }

/** Slice 1 placeholder: proves env vars, anonymous auth and migrations are in place. */
export default function Home() {
  const [status, setStatus] = useState<Status>(isConfigured ? { kind: 'checking' } : { kind: 'not_configured' })

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false
    ;(async () => {
      try {
        const uid = await ensureAnonymousUser()
        // A member-scoped table: returns [] for a new user if the migrations ran, an error if not.
        const { error } = await supabase.from('sessions').select('id').limit(1)
        const db = !error ? 'ok' : /does not exist|schema cache|PGRST205/i.test(`${error.code} ${error.message}`) ? 'missing' : error.message
        if (!cancelled) setStatus({ kind: 'connected', uid, db })
      } catch (e) {
        if (!cancelled) setStatus({ kind: 'error', message: friendlyError(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-full max-w-screen-sm flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Fate Table</h1>
        <p className="mt-1 text-[color:var(--muted)]">Run Fate Core, Accelerated and Condensed sessions together.</p>
      </header>

      <section
        className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5 shadow-sm"
        aria-live="polite"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">Connection</h2>
        <StatusBody status={status} />
      </section>

      <p className="text-sm text-[color:var(--muted)]">
        Creating and joining sessions arrives in the next slice.
      </p>
    </main>
  )
}

function StatusBody({ status }: { status: Status }) {
  switch (status.kind) {
    case 'checking':
      return <p className="mt-2">Connecting…</p>
    case 'not_configured':
      return (
        <div className="mt-2 space-y-2">
          <p className="font-medium text-red-700 dark:text-red-400">Supabase isn’t configured.</p>
          <p className="text-sm">
            Copy <code>.env.example</code> to <code>.env.local</code>, fill in your project URL and anon key, then restart{' '}
            <code>npm run dev</code>. See the README.
          </p>
        </div>
      )
    case 'error':
      return (
        <div className="mt-2 space-y-2">
          <p className="font-medium text-red-700 dark:text-red-400">Couldn’t sign in.</p>
          <p className="text-sm">{status.message}</p>
          <p className="text-sm text-[color:var(--muted)]">
            Check that anonymous sign-ins are enabled (Authentication → Sign In / Providers).
          </p>
        </div>
      )
    case 'connected':
      return (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-[color:var(--muted)]">Signed in</dt>
          <dd>
            Connected as <code className="break-all">{status.uid}</code> (anonymous)
          </dd>
          <dt className="text-[color:var(--muted)]">Database</dt>
          <dd>
            {status.db === 'ok' && <span className="text-green-700 dark:text-green-400">Ready</span>}
            {status.db === 'missing' && (
              <span className="text-red-700 dark:text-red-400">Tables not found. Run the migrations (README).</span>
            )}
            {status.db !== 'ok' && status.db !== 'missing' && <span className="text-red-700 dark:text-red-400">{status.db}</span>}
          </dd>
        </dl>
      )
  }
}
