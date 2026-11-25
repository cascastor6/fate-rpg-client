import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-amber-700 text-white hover:bg-amber-800 active:bg-amber-900 disabled:bg-amber-700/50',
  secondary:
    'border border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--fg)] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50',
  ghost: 'text-[color:var(--fg)] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:opacity-50',
}

export function Button({
  variant = 'primary',
  className = '',
  busy = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5 shadow-sm ${className}`}
    >
      {children}
    </section>
  )
}

export function TextField({
  label,
  hint,
  error,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  const id = useId()
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-msg` : undefined}
        {...rest}
        className="min-h-12 w-full min-w-0 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-base outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/30 aria-invalid:border-red-600"
      />
      {(error || hint) && (
        <p id={`${id}-msg`} className={`text-sm ${error ? 'text-red-700 dark:text-red-400' : 'text-[color:var(--muted)]'}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100'
      : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  )
}

export function FullScreenSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-full items-center justify-center gap-3 text-[color:var(--muted)]" role="status">
      <Spinner className="size-6" />
      {label}
    </div>
  )
}
