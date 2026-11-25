import { describe, expect, it } from 'vitest'
import { relativeTime, rollBreakdown } from './format.ts'
import { ladderLabel } from './ladder.ts'
import { dieMotion, FACE_VALUE, FACES, hash32, mulberry32 } from './prng.ts'

describe('prng', () => {
  it('is deterministic per seed and spreads values', () => {
    const a = mulberry32(42), b = mulberry32(42)
    const xs = Array.from({ length: 1000 }, () => a())
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThan(1)
    expect(xs.filter((x) => x < 0.5).length).toBeGreaterThan(400)
    expect(hash32('roll:0')).not.toBe(hash32('roll:1'))
  })
})

describe('dieMotion', () => {
  const id = '3f1c2a8e-0000-4000-8000-000000000001'
  it('is identical for every client', () => {
    expect(dieMotion(id, 2, -1)).toEqual(dieMotion(id, 2, -1))
    expect(dieMotion(id, 0, 1)).not.toEqual(dieMotion(id, 1, 1))
  })
  it.each([-1, 0, 1])('lands a %i face toward the viewer', (v) => {
    for (let i = 0; i < 50; i++) {
      const m = dieMotion(`roll-${i}`, i % 4, v)
      expect(FACE_VALUE[m.face]).toBe(v)
      // Extra spins are whole turns, so the end pose is the face's base pose.
      expect(((m.end.x % 360) + 360) % 360).toBe(((FACES[m.face].x % 360) + 360) % 360)
      expect(((m.end.y % 360) + 360) % 360).toBe(((FACES[m.face].y % 360) + 360) % 360)
      expect(Math.abs(m.end.z)).toBeLessThanOrEqual(8)
      expect(m.end.x - FACES[m.face].x).toBeGreaterThanOrEqual(360)
    }
  })
})

describe('format', () => {
  it('matches the spec examples', () => {
    expect(rollBreakdown({ dice_total: 2, label: 'Fight', skill_value: 3, bonus: 0, total: 5 })).toBe('+2 Fight +3 = Superb (+5)')
    expect(rollBreakdown({ dice_total: 1, label: null, skill_value: 0, bonus: 0, total: 1 })).toBe('+1 = Average (+1)')
    expect(rollBreakdown({ dice_total: -1, label: 'Notice', skill_value: 2, bonus: 2, total: 3 })).toBe('−1 Notice +2 +2 = Good (+3)')
    expect(rollBreakdown({ dice_total: -4, label: null, skill_value: 0, bonus: 0, total: -4 })).toBe('−4 = Terrible (−4)')
    expect(ladderLabel(10)).toBe('Legendary +2 (+10)')
  })
  it('relative time', () => {
    const now = Date.parse('2026-11-25T12:00:00Z')
    expect(relativeTime('2026-11-25T11:59:50Z', now)).toBe('just now')
    expect(relativeTime('2026-11-25T11:57:00Z', now)).toBe('3 min ago')
    expect(relativeTime('2026-11-25T09:00:00Z', now)).toBe('3 h ago')
  })
})
