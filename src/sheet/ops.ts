// Sheet edits as operations (SPEC §6.3). Each op is applied optimistically to the
// local view and sent to the server in order; applyOp is pure so the view can be
// recomputed as server rows arrive.

import { byPosition } from '../lib/positions.ts'
import type { BlockProps, BlockRow, BlockType, BlockValue, CharacterRow, SectionRow, SheetJson, StressBox } from './types.ts'

export type SheetData = {
  character: CharacterRow
  sections: SectionRow[]
  blocks: BlockRow[]
}

export type BlockPatch = {
  label?: string
  value?: BlockValue
  type?: BlockType
  section_id?: string
  position?: number
  /** merged into props; a null value removes the key */
  props?: { [K in keyof BlockProps]?: BlockProps[K] | null }
}

export type SheetOpBody =
  | { kind: 'patch'; blockId: string; patch: BlockPatch }
  | { kind: 'stress'; blockId: string; index: number; checked: boolean }
  | { kind: 'adjust'; blockId: string; delta: number }
  | { kind: 'fate'; delta: number }
  | { kind: 'character'; patch: Partial<Pick<CharacterRow, 'name' | 'refresh'>> }
  | { kind: 'insert_block'; block: BlockRow }
  | { kind: 'delete_block'; blockId: string }
  | { kind: 'insert_section'; section: SectionRow }
  | { kind: 'patch_section'; sectionId: string; patch: Partial<Pick<SectionRow, 'title' | 'position'>> }
  | { kind: 'delete_section'; sectionId: string; withBlocks: boolean }
  | { kind: 'rebalance' }
  /** whole-sheet write (import / apply template); rows are the optimistic preview */
  | { kind: 'replace'; sheet: SheetJson; preview: { character: Partial<CharacterRow>; sections: SectionRow[]; blocks: BlockRow[] } }

export type SheetOp = SheetOpBody & {
  opId: string
  /** last time this op was created or merged into (ms), for debouncing */
  touchedAt: number
  /** true once handed to the network; sent ops are never merged into */
  sent?: boolean
}

function mergeProps(base: BlockProps, patch: BlockPatch['props']): BlockProps {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null || v === undefined) delete out[k]
    else out[k] = v
  }
  return out as BlockProps
}

/** Apply a server-equivalent change to one block. Mirrors the SQL RPCs. */
export function applyToBlock(b: BlockRow, op: SheetOpBody): BlockRow {
  switch (op.kind) {
    case 'patch':
      return {
        ...b,
        label: op.patch.label ?? b.label,
        type: op.patch.type ?? b.type,
        section_id: op.patch.section_id ?? b.section_id,
        position: op.patch.position ?? b.position,
        value: 'value' in op.patch ? (op.patch.value as BlockValue) : b.value,
        props: op.patch.props ? mergeProps(b.props, op.patch.props) : b.props,
      }
    case 'stress': {
      const boxes = Array.isArray(b.value) ? (b.value as StressBox[]) : []
      if (op.index < 0 || op.index >= boxes.length) return b
      return { ...b, value: boxes.map((box, i) => (i === op.index ? { ...box, checked: op.checked } : box)) }
    }
    case 'adjust': {
      const current = typeof b.value === 'number' ? b.value : 0
      if (b.type === 'counter') {
        const max = b.props.max ?? Infinity
        return { ...b, value: Math.max(0, Math.min(max, current + Math.trunc(op.delta))) }
      }
      if (b.type === 'skill') return { ...b, value: current + Math.trunc(op.delta) }
      if (b.type === 'number') return { ...b, value: current + op.delta }
      return b
    }
    default:
      return b
  }
}

export function applyOp(data: SheetData, op: SheetOpBody): SheetData {
  switch (op.kind) {
    case 'fate':
      return { ...data, character: { ...data.character, fate_points: Math.max(0, data.character.fate_points + op.delta) } }
    case 'character':
      return { ...data, character: { ...data.character, ...op.patch } }
    case 'insert_block':
      return { ...data, blocks: [...data.blocks.filter((b) => b.id !== op.block.id), op.block] }
    case 'delete_block':
      return { ...data, blocks: data.blocks.filter((b) => b.id !== op.blockId) }
    case 'insert_section':
      return { ...data, sections: [...data.sections.filter((s) => s.id !== op.section.id), op.section] }
    case 'patch_section':
      return { ...data, sections: data.sections.map((s) => (s.id === op.sectionId ? { ...s, ...op.patch } : s)) }
    case 'delete_section':
      if (!op.withBlocks && data.blocks.some((b) => b.section_id === op.sectionId)) return data
      return {
        ...data,
        sections: data.sections.filter((s) => s.id !== op.sectionId),
        blocks: data.blocks.filter((b) => b.section_id !== op.sectionId),
      }
    case 'rebalance':
      return data
    case 'replace':
      return {
        character: { ...data.character, ...op.preview.character },
        sections: op.preview.sections,
        blocks: op.preview.blocks,
      }
    default:
      return { ...data, blocks: data.blocks.map((b) => (b.id === op.blockId ? applyToBlock(b, op) : b)) }
  }
}

/** Keep sections and blocks in display order after ops that move things. */
export function sortSheet(data: SheetData): SheetData {
  return { ...data, sections: [...data.sections].sort(byPosition), blocks: [...data.blocks].sort(byPosition) }
}

/**
 * Try to fold a new op into the last pending one (repeated stepper taps become one
 * delta; repeated edits of one block become one patch). Returns the merged op or null.
 */
export function tryMerge(last: SheetOp | undefined, next: SheetOpBody): SheetOpBody | null {
  if (!last || last.sent) return null
  if (last.kind === 'adjust' && next.kind === 'adjust' && last.blockId === next.blockId) {
    return { ...last, delta: last.delta + next.delta }
  }
  if (last.kind === 'fate' && next.kind === 'fate') return { ...last, delta: last.delta + next.delta }
  if (last.kind === 'patch' && next.kind === 'patch' && last.blockId === next.blockId) {
    return {
      ...last,
      patch: {
        ...last.patch,
        ...next.patch,
        ...(last.patch.props || next.patch.props ? { props: { ...last.patch.props, ...next.patch.props } } : {}),
      },
    }
  }
  return null
}

/** Ops that wait briefly before sending, so quick repeated taps merge. */
export const isDebounced = (op: SheetOpBody) => op.kind === 'adjust' || op.kind === 'fate'
