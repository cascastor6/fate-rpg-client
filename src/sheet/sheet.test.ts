import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ladderLabel, ladderName, signed } from '../dice/ladder.ts'
import { byPosition, needsRebalance, positionBetween } from '../lib/positions.ts'
import { logicalToRowFields, rowToLogical } from './convert.ts'
import { applyOp, tryMerge, type SheetData, type SheetOp } from './ops.ts'
import { buildTemplate, TEMPLATES } from './templates.ts'
import { BLOCK_TYPES, PROPS_BY_TYPE, type BlockRow, type TemplateId } from './types.ts'
import { blockProblem } from './validate.ts'

const ALL: TemplateId[] = ['core', 'accelerated', 'condensed', 'blank', 'npc']

describe('templates', () => {
  it.each(ALL)('%s: every block is valid, ids unique and well-formed, sections exist', (t) => {
    const sheet = buildTemplate(t, 'Test')
    const ids = sheet.blocks.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sectionIds = new Set(sheet.sections.map((s) => s.id))
    for (const s of sheet.sections) expect(s.id).toMatch(/^s_[a-z0-9_]{3,32}$/)
    for (const b of sheet.blocks) {
      expect(b.id).toMatch(/^b_[a-z0-9]{6,32}$/)
      expect(sectionIds.has(b.section)).toBe(true)
      const { value, props, type } = logicalToRowFields(b)
      expect(blockProblem(type, value, props)).toBeNull()
    }
  })
  it('core has 18 skills, condensed 19, accelerated 6 approaches', () => {
    const count = (t: TemplateId) => buildTemplate(t, 'x').blocks.filter((b) => b.type === 'skill').length
    expect(count('core')).toBe(18)
    expect(count('condensed')).toBe(19)
    expect(count('accelerated')).toBe(6)
    expect(count('npc')).toBe(2)
  })
  it('core stress has 2 usable boxes of 4; condensed 3 of 6', () => {
    const phys = (t: TemplateId) => buildTemplate(t, 'x').blocks.find((b) => b.type === 'stress')!.value as { disabled?: boolean }[]
    expect(phys('core').filter((b) => !b.disabled)).toHaveLength(2)
    expect(phys('condensed')).toHaveLength(6)
    expect(phys('condensed').filter((b) => !b.disabled)).toHaveLength(3)
  })
  it('generates fresh ids each time', () => {
    expect(buildTemplate('core', 'a').blocks[0].id).not.toBe(buildTemplate('core', 'a').blocks[0].id)
  })
  it('offers the four player templates', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['core', 'accelerated', 'condensed', 'blank'])
  })
})

describe('blockProblem', () => {
  it('accepts good values and rejects bad ones', () => {
    expect(blockProblem('skill', 3, { rollable: true })).toBeNull()
    expect(blockProblem('skill', 2.5)).toMatch(/whole/)
    expect(blockProblem('skill', '3')).toMatch(/number/)
    expect(blockProblem('aspect', 'x', { role: 'villain' })).toMatch(/role/)
    expect(blockProblem('text', 'x', { rollable: true })).toMatch(/not allowed/)
    expect(blockProblem('image', 'http://x.test/a.png')).toMatch(/https/)
    expect(blockProblem('image', '')).toBeNull()
    expect(blockProblem('stress', [{ size: 0, checked: false }])).toMatch(/1–10/)
    expect(blockProblem('stress', [{ size: 1, checked: false, extra: 1 }])).toMatch(/invalid/)
    expect(blockProblem('separator', null)).toBeNull()
    expect(blockProblem('counter', 1, { max: -1 })).toMatch(/max/)
    expect(blockProblem('nope', 1)).toMatch(/unknown/)
    expect(blockProblem('gear', '', {})).toBeNull()
    expect(blockProblem('gear', '+2 to Shoot', { quantity: 3 })).toBeNull()
    expect(blockProblem('gear', 'x', { quantity: -1 })).toMatch(/quantity/)
    expect(blockProblem('gear', 'x', { quantity: 1.5 })).toMatch(/quantity/)
    expect(blockProblem('gear', 5)).toMatch(/text/)
  })
  it('the database accepts the same block types', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const latest = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => readFileSync(new URL(f, dir), 'utf8')).filter((t) => t.includes('sheet_blocks_type_check')).at(-1)!
    const list = latest.slice(latest.indexOf('add constraint sheet_blocks_type_check'))
    const types = [...list.slice(0, list.indexOf(');')).matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect(types).toEqual([...BLOCK_TYPES])
  })
  it('allows the same props per type as the database trigger', () => {
    // The newest migration that (re)defines validate_block is the one in force.
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    const sql = files.map((f) => readFileSync(new URL(f, dir), 'utf8')).filter((t) => t.includes('function private.validate_block()')).at(-1)!
    for (const t of BLOCK_TYPES) {
      const extra = PROPS_BY_TYPE[t].filter((k) => k !== 'hint')
      if (extra.length === 0) continue
      const line = sql.split('\n').find((l) => l.includes(`when '${t}'`) && l.includes('then array['))
      expect(line, t).toBeDefined()
      expect([...line!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).slice(1)).toEqual(extra)
    }
  })
})

describe('convert', () => {
  it('round-trips a logical block through row fields', () => {
    const b = { id: 'b_abcdef1234', type: 'consequence' as const, label: 'Mild', value: 'Bruised', section: 's_conseq', shift: 2, free_invokes: 1 }
    const row = { ...logicalToRowFields(b), character_id: 'c', position: 1, version: 1 } as BlockRow
    expect(row.props).toEqual({ shift: 2, free_invokes: 1 })
    expect(rowToLogical(row)).toEqual(b)
  })
})

function sample(): SheetData {
  const block = (id: string, type: BlockRow['type'], value: BlockRow['value'], props = {}): BlockRow =>
    ({ character_id: 'c', id, section_id: 's_x', type, label: id, value, props, position: 1, version: 1 })
  return {
    character: { id: 'c', session_id: 's', kind: 'pc', owner_id: 'u', name: 'A', template: 'core', fate_points: 1,
      refresh: 3, visible_to_players: false, position: 0, version: 1 },
    sections: [],
    blocks: [
      block('b_skill', 'skill', 2),
      block('b_counter', 'counter', 4, { max: 5 }),
      block('b_stress', 'stress', [{ size: 1, checked: false }, { size: 2, checked: false }]),
      block('b_aspect', 'aspect', 'Old', { role: 'other', hint: 'h' }),
    ],
  }
}
const find = (d: SheetData, id: string) => d.blocks.find((b) => b.id === id)!

describe('applyOp (optimistic, mirrors the RPCs)', () => {
  it('patches label, value and merges props (null removes)', () => {
    const d = applyOp(sample(), { kind: 'patch', blockId: 'b_aspect', patch: { value: 'New', props: { role: 'trouble', hint: null } } })
    expect(find(d, 'b_aspect')).toMatchObject({ value: 'New', label: 'b_aspect', props: { role: 'trouble' } })
    expect(find(d, 'b_aspect').props).not.toHaveProperty('hint')
  })
  it('clamps counters to 0..max and truncates skill deltas', () => {
    expect(find(applyOp(sample(), { kind: 'adjust', blockId: 'b_counter', delta: 5 }), 'b_counter').value).toBe(5)
    expect(find(applyOp(sample(), { kind: 'adjust', blockId: 'b_counter', delta: -9 }), 'b_counter').value).toBe(0)
    expect(find(applyOp(sample(), { kind: 'adjust', blockId: 'b_skill', delta: 1.7 }), 'b_skill').value).toBe(3)
  })
  it('sets one stress box', () => {
    const v = find(applyOp(sample(), { kind: 'stress', blockId: 'b_stress', index: 1, checked: true }), 'b_stress').value
    expect(v).toEqual([{ size: 1, checked: false }, { size: 2, checked: true }])
  })
  it('never takes fate points below zero', () => {
    expect(applyOp(sample(), { kind: 'fate', delta: -3 }).character.fate_points).toBe(0)
    expect(applyOp(sample(), { kind: 'fate', delta: 2 }).character.fate_points).toBe(3)
  })
  it('does not mutate its input', () => {
    const d = sample()
    applyOp(d, { kind: 'stress', blockId: 'b_stress', index: 0, checked: true })
    expect((find(d, 'b_stress').value as { checked: boolean }[])[0].checked).toBe(false)
  })
})

describe('tryMerge', () => {
  const op = (o: object, sent = false) => ({ opId: 'x', touchedAt: 0, sent, ...o }) as SheetOp
  it('folds repeated steps on one block into one delta', () => {
    expect(tryMerge(op({ kind: 'adjust', blockId: 'b', delta: 1 }), { kind: 'adjust', blockId: 'b', delta: 1 })).toMatchObject({ delta: 2 })
    expect(tryMerge(op({ kind: 'fate', delta: 1 }), { kind: 'fate', delta: -1 })).toMatchObject({ delta: 0 })
  })
  it('never merges into a sent op or across blocks', () => {
    expect(tryMerge(op({ kind: 'adjust', blockId: 'b', delta: 1 }, true), { kind: 'adjust', blockId: 'b', delta: 1 })).toBeNull()
    expect(tryMerge(op({ kind: 'adjust', blockId: 'a', delta: 1 }), { kind: 'adjust', blockId: 'b', delta: 1 })).toBeNull()
  })
  it('combines patches to one block', () => {
    expect(tryMerge(op({ kind: 'patch', blockId: 'b', patch: { label: 'L' } }), { kind: 'patch', blockId: 'b', patch: { value: 'V' } }))
      .toMatchObject({ patch: { label: 'L', value: 'V' } })
  })
})

describe('positions', () => {
  it('finds midpoints and ends', () => {
    expect(positionBetween()).toBe(1024)
    expect(positionBetween(1024, 2048)).toBe(1536)
    expect(positionBetween(null, 1024)).toBe(0)
    expect(positionBetween(2048, null)).toBe(3072)
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true)
    expect(needsRebalance(1, 2)).toBe(false)
  })
  it('sorts by position then id', () => {
    const items = [{ id: 'b', position: 1 }, { id: 'a', position: 1 }, { id: 'c', position: 0 }]
    expect(items.sort(byPosition).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('ladder', () => {
  it('names values', () => {
    expect(ladderName(3)).toBe('Good')
    expect(ladderName(-3)).toBe('Terrible')
    expect(ladderName(9)).toBe('Legendary +1')
    expect(signed(-2)).toBe('−2')
    expect(ladderLabel(5)).toBe('Superb (+5)')
  })
})
