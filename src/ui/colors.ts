// Player colours (SPEC §7.8). Stored as keys; mapped to a fill and a readable ink colour.

export const PALETTE = [
  'red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink', 'slate',
] as const

export type PlayerColor = (typeof PALETTE)[number]

/** fill: swatch / dice body. ink: text drawn on top of fill (at least 4.5:1). */
export const COLORS: Record<PlayerColor, { fill: string; ink: string; label: string }> = {
  red:    { fill: '#dc2626', ink: '#ffffff', label: 'Red' },
  orange: { fill: '#ea580c', ink: '#1c1917', label: 'Orange' },
  amber:  { fill: '#f59e0b', ink: '#1c1917', label: 'Amber' },
  lime:   { fill: '#84cc16', ink: '#1c1917', label: 'Lime' },
  green:  { fill: '#16a34a', ink: '#ffffff', label: 'Green' },
  teal:   { fill: '#0d9488', ink: '#ffffff', label: 'Teal' },
  cyan:   { fill: '#06b6d4', ink: '#1c1917', label: 'Cyan' },
  blue:   { fill: '#2563eb', ink: '#ffffff', label: 'Blue' },
  indigo: { fill: '#4f46e5', ink: '#ffffff', label: 'Indigo' },
  violet: { fill: '#7c3aed', ink: '#ffffff', label: 'Violet' },
  pink:   { fill: '#db2777', ink: '#ffffff', label: 'Pink' },
  slate:  { fill: '#475569', ink: '#ffffff', label: 'Slate' },
}

export function isPlayerColor(c: unknown): c is PlayerColor {
  return typeof c === 'string' && (PALETTE as readonly string[]).includes(c)
}

export function colorOf(c: string | null | undefined) {
  return COLORS[isPlayerColor(c) ? c : 'slate']
}

/** First palette colour nobody is using, or slate if all are taken. */
export function firstUnusedColor(taken: readonly string[]): PlayerColor {
  return PALETTE.find((c) => !taken.includes(c)) ?? 'slate'
}
