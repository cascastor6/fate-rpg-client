import { IconMinus, IconPlus } from './icons.tsx'

/** − value + with 44px+ targets. `format` renders the value (e.g. signed). */
export function Stepper({
  value,
  onStep,
  format = String,
  size = 'md',
  label,
  min,
  max,
}: {
  value: number
  onStep: (delta: number) => void
  format?: (n: number) => string
  size?: 'md' | 'lg'
  label: string
  min?: number
  max?: number
}) {
  const btn = size === 'lg' ? 'size-14 text-2xl' : 'size-11'
  const num = size === 'lg' ? 'min-w-20 text-4xl' : 'min-w-10 text-xl'
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        className={`${btn} flex items-center justify-center rounded-full border border-[color:var(--border)] hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10`}
        onClick={() => onStep(-1)}
        disabled={min !== undefined && value <= min}
        aria-label={`Decrease ${label}`}
      >
        <IconMinus />
      </button>
      <output className={`${num} text-center font-bold tabular-nums`} aria-live="polite">{format(value)}</output>
      <button
        type="button"
        className={`${btn} flex items-center justify-center rounded-full border border-[color:var(--border)] hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10`}
        onClick={() => onStep(1)}
        disabled={max !== undefined && value >= max}
        aria-label={`Increase ${label}`}
      >
        <IconPlus />
      </button>
    </div>
  )
}
