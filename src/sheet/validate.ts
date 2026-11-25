// Block validation (SPEC §5.4). Mirrors the private.validate_block trigger.

import { BLOCK_TYPES, PROPS_BY_TYPE, type BlockProps, type BlockType } from './types.ts'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Returns a reason string if the block is invalid, otherwise null. */
export function blockProblem(type: string, value: unknown, props: Record<string, unknown> = {}): string | null {
  if (!(BLOCK_TYPES as readonly string[]).includes(type)) return `unknown type "${type}"`
  const t = type as BlockType

  switch (t) {
    case 'text': case 'aspect': case 'consequence': case 'image': case 'gear':
      if (typeof value !== 'string') return 'value must be text'
      if (value.length > 2000) return 'text is too long (max 2000)'
      if (t === 'image' && value !== '' && !value.startsWith('https://')) return 'image URL must start with https://'
      break
    case 'skill': case 'counter': case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'value must be a number'
      if (t !== 'number' && !Number.isInteger(value)) return 'value must be a whole number'
      if (Math.abs(value) > 1e9) return 'value is too large'
      break
    case 'stress':
      if (!Array.isArray(value) || value.length > 20) return 'stress must be a list of up to 20 boxes'
      for (const box of value as unknown[]) {
        if (typeof box !== 'object' || box === null) return 'invalid stress box'
        const b = box as Record<string, unknown>
        if (Object.keys(b).some((k) => !['size', 'checked', 'disabled'].includes(k))) return 'invalid stress box'
        if (!isInt(b.size) || b.size < 1 || b.size > 10) return 'box size must be 1–10'
        if (typeof b.checked !== 'boolean') return 'invalid stress box'
        if ('disabled' in b && typeof b.disabled !== 'boolean') return 'invalid stress box'
      }
      break
    case 'separator':
      if (value !== null && value !== undefined) return 'separator has no value'
      break
  }

  const allowed = PROPS_BY_TYPE[t] as readonly string[]
  for (const [k, v] of Object.entries(props)) {
    if (!allowed.includes(k)) return `"${k}" is not allowed on ${t}`
    const p = k as keyof BlockProps
    if ((p === 'hint' || p === 'alt') && (typeof v !== 'string' || v.length > 200)) return `invalid ${k}`
    if ((p === 'multiline' || p === 'rollable') && typeof v !== 'boolean') return `invalid ${k}`
    if (p === 'role' && !['high_concept', 'trouble', 'other'].includes(v as string)) return 'invalid role'
    if ((p === 'shift' || p === 'free_invokes' || p === 'max' || p === 'refresh' || p === 'quantity') && (!isInt(v) || v < 0 || v > 999)) {
      return `invalid ${k}`
    }
  }
  return null
}
