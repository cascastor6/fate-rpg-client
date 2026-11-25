// Fractional ordering (SPEC §4.4): a new item goes at the midpoint of its neighbours.

export const POSITION_STEP = 1024
export const MIN_GAP = 1e-6

/** A position strictly between `before` and `after` (either may be missing). */
export function positionBetween(before?: number | null, after?: number | null): number {
  if (before == null && after == null) return POSITION_STEP
  if (before == null) return after! - POSITION_STEP
  if (after == null) return before + POSITION_STEP
  return (before + after) / 2
}

/** True when two neighbours are too close to fit another item between them. */
export function needsRebalance(before?: number | null, after?: number | null): boolean {
  return before != null && after != null && Math.abs(after - before) < MIN_GAP
}

export function byPosition<T extends { position: number; id: string }>(a: T, b: T): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
