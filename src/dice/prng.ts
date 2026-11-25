// Deterministic tumble (SPEC §7.2): every client derives the same extra spins from the
// roll id, so everyone sees the same animation, not just the same result.

/** FNV-1a 32-bit hash. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, good enough for animation. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cube faces and the rotation (deg) that turns each one toward the viewer. */
export const FACES = {
  front: { x: 0, y: 0 },
  back: { x: 0, y: 180 },
  right: { x: 0, y: -90 },
  left: { x: 0, y: 90 },
  top: { x: -90, y: 0 },
  bottom: { x: 90, y: 0 },
} as const
export type Face = keyof typeof FACES

/** Opposite faces share a symbol: + on front/back, blank on left/right, − on top/bottom. */
export const FACE_VALUE: Record<Face, -1 | 0 | 1> = { front: 1, back: 1, right: 0, left: 0, top: -1, bottom: -1 }
const FACES_FOR: Record<-1 | 0 | 1, [Face, Face]> = { [1]: ['front', 'back'], [0]: ['right', 'left'], [-1]: ['top', 'bottom'] }

export type DieMotion = {
  face: Face
  /** final rotation, deg */
  end: { x: number; y: number; z: number }
  /** starting rotation, deg */
  start: { x: number; y: number; z: number }
}

/** The same motion on every client for (roll id, die index, value). */
export function dieMotion(rollId: string, index: number, value: number): DieMotion {
  const rnd = mulberry32(hash32(`${rollId}:${index}`))
  const v = (value > 0 ? 1 : value < 0 ? -1 : 0) as -1 | 0 | 1
  const face = FACES_FOR[v][rnd() < 0.5 ? 0 : 1]
  const base = FACES[face]
  const turnsX = 1 + Math.floor(rnd() * 3) // 1..3 full turns
  const turnsY = 1 + Math.floor(rnd() * 3)
  const jitter = Math.round((rnd() - 0.5) * 16) // ±8deg, around the viewing axis
  return {
    face,
    end: { x: base.x + 360 * turnsX, y: base.y + 360 * turnsY, z: jitter },
    start: { x: Math.round(rnd() * 360), y: Math.round(rnd() * 360), z: Math.round((rnd() - 0.5) * 90) },
  }
}
