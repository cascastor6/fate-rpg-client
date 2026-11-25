import { describe, expect, it } from 'vitest'
import { applyOp, sortSheet, type SheetData } from './ops.ts'
import { mergeRemote, upsertRow } from './remote.ts'
import type { BlockRow } from './types.ts'

const blk = (id: string, value: number, version = 1, position = 1): BlockRow =>
  ({ character_id: 'c', id, section_id: 's_x', type: 'skill', label: id, value, props: {}, position, version })
const sheet = (): SheetData => ({
  character: { id: 'c', session_id: 's', kind: 'pc', owner_id: 'u', name: 'A', template: 'core', fate_points: 3, refresh: 3,
    visible_to_players: false, position: 0, version: 5 },
  sections: [{ character_id: 'c', id: 's_x', title: 'X', position: 1, version: 1 }],
  blocks: [blk('b_a', 1, 3, 1), blk('b_b', 2, 1, 2)],
})

describe('mergeRemote', () => {
  it('applies newer updates and ignores stale or equal ones', () => {
    const d = sheet()
    expect(mergeRemote(d, { table: 'sheet_blocks', type: 'UPDATE', row: blk('b_a', 9, 4) }).blocks[0].value).toBe(9)
    expect(mergeRemote(d, { table: 'sheet_blocks', type: 'UPDATE', row: blk('b_a', 9, 3) })).toBe(d)
    expect(mergeRemote(d, { table: 'sheet_blocks', type: 'UPDATE', row: blk('b_a', 9, 2) })).toBe(d)
  })
  it('always takes inserts (replace_sheet re-inserts ids at version 1) and keeps order', () => {
    const d = mergeRemote(sheet(), { table: 'sheet_blocks', type: 'INSERT', row: blk('b_new', 0, 1, 1.5) })
    expect(d.blocks.map((b) => b.id)).toEqual(['b_a', 'b_new', 'b_b'])
    expect(mergeRemote(sheet(), { table: 'sheet_blocks', type: 'INSERT', row: blk('b_a', 7, 1) }).blocks[0].value).toBe(7)
  })
  it('deletes by primary key only', () => {
    const d = mergeRemote(sheet(), { table: 'sheet_blocks', type: 'DELETE', row: { character_id: 'c', id: 'b_a' } })
    expect(d.blocks.map((b) => b.id)).toEqual(['b_b'])
  })
  it('ignores other characters and unknown deletes', () => {
    const d = sheet()
    expect(mergeRemote(d, { table: 'sheet_blocks', type: 'UPDATE', row: { ...blk('b_a', 9, 9), character_id: 'other' } })).toBe(d)
    expect(mergeRemote(d, { table: 'sheet_blocks', type: 'DELETE', row: { character_id: 'c', id: 'b_zzz' } })).toBe(d)
  })
  it('updates the character row by version', () => {
    const d = sheet()
    const newer = { ...d.character, fate_points: 1, version: 6 }
    expect(mergeRemote(d, { table: 'characters', type: 'UPDATE', row: newer }).character.fate_points).toBe(1)
    expect(mergeRemote(d, { table: 'characters', type: 'UPDATE', row: { ...newer, version: 5 } })).toBe(d)
  })
  it('re-applying pending ops on top keeps local edits visible (no flicker)', () => {
    // Local: +1 to b_b pending. Remote: someone else edits b_a.
    const server = mergeRemote(sheet(), { table: 'sheet_blocks', type: 'UPDATE', row: blk('b_a', 5, 4) })
    const view = sortSheet(applyOp(server, { kind: 'adjust', blockId: 'b_b', delta: 1 }))
    expect(view.blocks.map((b) => b.value)).toEqual([5, 3])
  })
})

describe('upsertRow', () => {
  it('works on any keyed list', () => {
    const list = [{ id: 'a', version: 1, n: 1 }]
    expect(upsertRow(list, 'INSERT', { id: 'b', version: 1, n: 2 })).toHaveLength(2)
    expect(upsertRow(list, 'UPDATE', { id: 'a', version: 2, n: 9 })[0].n).toBe(9)
    expect(upsertRow(list, 'DELETE', { id: 'a' })).toHaveLength(0)
  })
})
