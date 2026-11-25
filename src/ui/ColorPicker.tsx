import { COLORS, PALETTE, type PlayerColor } from './colors.ts'

/**
 * A row of 12 colour swatches (radio group). Colours already used by someone are
 * marked with that person's initial but can still be picked (SPEC §7.8).
 */
export function ColorPicker({
  value,
  onChange,
  takenBy = {},
  label = 'Your colour',
}: {
  value: PlayerColor
  onChange: (c: PlayerColor) => void
  /** colour -> display name of someone using it, or true when we only know it's taken */
  takenBy?: Partial<Record<PlayerColor, string | true>>
  label?: string
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-6 gap-2" role="radiogroup">
        {PALETTE.map((c) => {
          const selected = c === value
          const taken = takenBy[c]
          const who = typeof taken === 'string' ? taken : null
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${COLORS[c].label}${who ? ` (used by ${who})` : taken ? ' (taken)' : ''}`}
              title={who ? `${COLORS[c].label}: ${who}` : taken ? `${COLORS[c].label} (taken)` : COLORS[c].label}
              onClick={() => onChange(c)}
              className={`relative flex aspect-square min-h-11 items-center justify-center rounded-full text-sm font-bold transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${
                selected ? 'scale-105 ring-4 ring-[color:var(--fg)] ring-offset-2 ring-offset-[color:var(--card)]' : ''
              }`}
              style={{ background: COLORS[c].fill, color: COLORS[c].ink }}
            >
              {selected ? '✓' : who ? who.trim().charAt(0).toUpperCase() : taken ? '•' : ''}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
