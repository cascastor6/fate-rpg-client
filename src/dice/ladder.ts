// The Fate ladder (SPEC §7.3).

const LADDER: Record<number, string> = {
  [-2]: 'Terrible', [-1]: 'Poor', 0: 'Mediocre', 1: 'Average', 2: 'Fair', 3: 'Good',
  4: 'Great', 5: 'Superb', 6: 'Fantastic', 7: 'Epic', 8: 'Legendary',
}

/** "+3", "0", "−2" (with a real minus sign). */
export function signed(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

/** Ladder adjective for a value: "Good", "Terrible", "Legendary +1". */
export function ladderName(n: number): string {
  if (n < -2) return 'Terrible'
  if (n > 8) return `Legendary +${n - 8}`
  return LADDER[n]
}

/** "Good (+3)", "Terrible (−4)", "Legendary +1 (+9)". */
export function ladderLabel(n: number): string {
  return `${ladderName(n)} (${signed(n)})`
}
