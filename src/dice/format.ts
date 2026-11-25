import { ladderLabel, signed } from './ladder.ts'
import type { RollRow } from './types.ts'

/** "+2 Fight +3 = Superb (+5)", "+1 = Average (+1)", "−1 Notice +2 +2 = Good (+3)" (SPEC §7.3). */
export function rollBreakdown(r: Pick<RollRow, 'dice_total' | 'label' | 'skill_value' | 'bonus' | 'total'>): string {
  const parts = [signed(r.dice_total)]
  if (r.label) parts.push(r.label, signed(r.skill_value))
  else if (r.skill_value) parts.push(signed(r.skill_value))
  if (r.bonus) parts.push(signed(r.bonus))
  return `${parts.join(' ')} = ${ladderLabel(r.total)}`
}

/** "Bea: +2 Fight +3 = Superb (+5)". */
export function rollSentence(r: RollRow): string {
  return `${r.roller_name}: ${rollBreakdown(r)}`
}

/** "just now", "3 min ago", "2 h ago", or a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}
