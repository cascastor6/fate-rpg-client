import type { BlockPatch } from './ops.ts'
import { PROPS_BY_TYPE, type BlockProps, type BlockRow, type BlockType, type BlockValue } from './types.ts'

export const BLOCK_TYPE_INFO: Record<BlockType, { name: string; blurb: string }> = {
  aspect: { name: 'Aspect', blurb: 'A phrase that’s true about you' },
  skill: { name: 'Skill', blurb: 'A rating you roll (+0 to +8)' },
  stress: { name: 'Stress track', blurb: 'Boxes you tick to absorb hits' },
  consequence: { name: 'Consequence', blurb: 'A lasting injury, absorbs shifts' },
  counter: { name: 'Counter', blurb: 'A tally with optional max and reset' },
  number: { name: 'Number', blurb: 'Any number, like money' },
  text: { name: 'Text', blurb: 'Notes, stunts, descriptions' },
  image: { name: 'Image', blurb: 'A picture from an https:// link' },
  separator: { name: 'Divider', blurb: 'A line with an optional heading' },
  gear: { name: 'Gear', blurb: 'An item: name, optional effect and quantity' },
}

/** Fields for a freshly added block of a type. */
export function defaultBlock(type: BlockType): { label: string; value: BlockValue; props: BlockProps } {
  switch (type) {
    case 'aspect': return { label: 'Aspect', value: '', props: { role: 'other' } }
    case 'skill': return { label: '', value: 0, props: { rollable: true } }
    case 'stress': return { label: 'Stress', value: [{ size: 1, checked: false }, { size: 2, checked: false }], props: {} }
    case 'consequence': return { label: 'Mild', value: '', props: { shift: 2 } }
    case 'counter': return { label: 'Counter', value: 0, props: {} }
    case 'number': return { label: 'Number', value: 0, props: {} }
    case 'text': return { label: 'Notes', value: '', props: { multiline: true } }
    case 'image': return { label: 'Image', value: '', props: {} }
    case 'separator': return { label: '', value: null, props: {} }
    case 'gear': return { label: '', value: '', props: {} }
  }
}

const NUMERIC: BlockType[] = ['skill', 'counter', 'number']
const TEXTUAL: BlockType[] = ['text', 'aspect', 'consequence']

/** Types a block can switch to without losing its value (SPEC §6.2). */
export function convertibleTypes(type: BlockType): BlockType[] {
  if (NUMERIC.includes(type)) return NUMERIC.filter((t) => t !== type)
  if (TEXTUAL.includes(type)) return TEXTUAL.filter((t) => t !== type)
  return []
}

/** The patch that changes a block's type: converts the value and drops props the new type can't have. */
export function typeChangePatch(block: BlockRow, to: BlockType): BlockPatch {
  const patch: BlockPatch = { type: to }
  if (NUMERIC.includes(to)) {
    const n = typeof block.value === 'number' ? block.value : 0
    const v = to === 'number' ? n : Math.trunc(n)
    patch.value = to === 'counter' ? Math.max(0, v) : v
  }
  const allowed = PROPS_BY_TYPE[to] as readonly string[]
  const props: NonNullable<BlockPatch['props']> = {}
  for (const k of Object.keys(block.props)) if (!allowed.includes(k)) (props as Record<string, null>)[k] = null
  const defaults = defaultBlock(to).props as Record<string, unknown>
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in block.props)) (props as Record<string, unknown>)[k] = v
  }
  if (Object.keys(props).length) patch.props = props
  return patch
}
