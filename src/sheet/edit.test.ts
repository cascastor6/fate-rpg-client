import { describe, expect, it } from 'vitest'
import { convertibleTypes, defaultBlock, typeChangePatch } from './defaults.ts'
import { exportSheet, exportFileName, parseImport, sheetToRows } from './io.ts'
import { applyOp, sortSheet, type SheetData } from './ops.ts'
import { buildTemplate } from './templates.ts'
import { BLOCK_TYPES, type BlockRow } from './types.ts'
import { blockProblem } from './validate.ts'

function dataFrom(template: Parameters<typeof buildTemplate>[0]): SheetData {
  const sheet = buildTemplate(template, 'Aldric')
  const rows = sheetToRows(sheet, 'c1')
  return {
    character: { id: 'c1', session_id: 's', kind: 'pc', owner_id: 'u', name: 'Aldric', template, fate_points: 3, refresh: 3,
      visible_to_players: false, position: 0, version: 1 },
    sections: rows.sections,
    blocks: rows.blocks,
  }
}

describe('defaults', () => {
  it.each(BLOCK_TYPES)('default %s block is valid', (t) => {
    const d = defaultBlock(t)
    expect(blockProblem(t, d.value, d.props as Record<string, unknown>)).toBeNull()
  })
  it('only offers lossless type changes', () => {
    expect(convertibleTypes('skill').sort()).toEqual(['counter', 'number'])
    expect(convertibleTypes('aspect').sort()).toEqual(['consequence', 'text'])
    expect(convertibleTypes('stress')).toEqual([])
  })
  it('type change patches produce valid blocks', () => {
    const skill: BlockRow = { character_id: 'c', id: 'b_x', section_id: 's', type: 'skill', label: 'Fight', value: -2,
      props: { rollable: true, hint: 'h' }, position: 1, version: 1 }
    const p = typeChangePatch(skill, 'counter')
    const after = applyOp({ character: {} as never, sections: [], blocks: [skill] }, { kind: 'patch', blockId: 'b_x', patch: p }).blocks[0]
    expect(after.type).toBe('counter')
    expect(after.value).toBe(0) // counters can't be negative
    expect(after.props).toEqual({ hint: 'h' })
    expect(blockProblem(after.type, after.value, after.props as Record<string, unknown>)).toBeNull()

    const aspect: BlockRow = { ...skill, type: 'aspect', value: 'Bruised', props: { role: 'trouble' } }
    const c = applyOp({ character: {} as never, sections: [], blocks: [aspect] }, { kind: 'patch', blockId: 'b_x', patch: typeChangePatch(aspect, 'consequence') }).blocks[0]
    expect(c).toMatchObject({ type: 'consequence', value: 'Bruised' })
    expect(blockProblem(c.type, c.value, c.props as Record<string, unknown>)).toBeNull()
  })
})

describe('export / import', () => {
  it.each(['core', 'accelerated', 'condensed', 'blank'] as const)('%s round-trips', (t) => {
    const data = dataFrom(t)
    const json = JSON.stringify(exportSheet(data))
    const res = parseImport(json)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.notes).toEqual([])
    expect(res.sheet).toEqual(exportSheet(data))
  })
  it('preserves order across sections after moves', () => {
    let data = dataFrom('core')
    const fight = data.blocks.find((b) => b.label === 'Fight')!
    data = sortSheet(applyOp(data, { kind: 'patch', blockId: fight.id, patch: { section_id: 's_notes', position: 1 } }))
    const exported = exportSheet(data)
    const idx = (label: string) => exported.blocks.findIndex((b) => b.label === label)
    expect(idx('Fight')).toBeLessThan(idx('Notes'))
    expect(idx('Fight')).toBeGreaterThan(idx('Extras'))
  })
  it('rejects junk with a message and changes nothing', () => {
    expect(parseImport('not json')).toMatchObject({ ok: false })
    expect(parseImport('{"sections":[],"blocks":[]}')).toMatchObject({ ok: false, error: expect.stringMatching(/format/) })
    const bad = { format: 'fate-table-sheet', sections: [{ id: 's_a', title: 'A' }], blocks: [{ id: 'b_aaaaaaa', type: 'skill', label: 'X', value: 'high', section: 's_a' }] }
    expect(parseImport(JSON.stringify(bad))).toMatchObject({ ok: false, error: expect.stringMatching(/Block 1 \(X\)/) })
  })
  it('fixes duplicate ids and orphan blocks, and says so', () => {
    const f = { format: 'fate-table-sheet', name: 'X', sections: [{ id: 's_aaa', title: 'A' }],
      blocks: [
        { id: 'b_dupdupdup', type: 'aspect', label: 'A', value: 'one', section: 's_aaa' },
        { id: 'b_dupdupdup', type: 'aspect', label: 'B', value: 'two', section: 's_aaa' },
        { id: 'b_orphan01', type: 'text', label: 'C', value: '', section: 's_missing' },
      ] }
    const res = parseImport(JSON.stringify(f))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(new Set(res.sheet.blocks.map((b) => b.id)).size).toBe(3)
    expect(res.sheet.blocks[2].section).toBe('s_imported')
    expect(res.notes.length).toBe(2)
  })
  it('makes a friendly file name', () => {
    expect(exportFileName('Sir Aldric of the Silver Order!')).toBe('sir-aldric-of-the-silver-order.fate.json')
    expect(exportFileName('  ')).toBe('character.fate.json')
  })
})

describe('structural ops', () => {
  it('insert, move, delete sections and blocks', () => {
    let d = dataFrom('blank')
    d = applyOp(d, { kind: 'insert_section', section: { character_id: 'c1', id: 's_new', title: 'Gear', position: 5000, version: 0 } })
    d = applyOp(d, { kind: 'insert_block', block: { character_id: 'c1', id: 'b_rope00001', section_id: 's_new', type: 'text', label: 'Rope', value: '', props: {}, position: 1, version: 0 } })
    expect(applyOp(d, { kind: 'delete_section', sectionId: 's_new', withBlocks: false }).sections).toHaveLength(3) // refused: not empty
    d = applyOp(d, { kind: 'delete_section', sectionId: 's_new', withBlocks: true })
    expect(d.sections.map((s) => s.id)).toEqual(['s_aspects', 's_notes'])
    expect(d.blocks).toHaveLength(0)
  })
})

describe('mergeSheet / withFreshIds', () => {
  it('merges sections by title and appends the rest, keeping existing blocks first', async () => {
    const { mergeSheet } = await import('./io.ts')
    const base = buildTemplate('blank', 'Aldric') // Aspects, Notes
    base.blocks = [{ id: 'b_mine000001', type: 'aspect', label: 'Mine', value: 'x', section: 's_aspects' }]
    const add = buildTemplate('accelerated', 'ignored')
    const res = mergeSheet(base, add)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sheet.name).toBe('Aldric')
    expect(res.sheet.sections.map((s) => s.title)).toEqual(['Aspects', 'Notes', 'Approaches', 'Stunts', 'Stress', 'Consequences'])
    const aspects = res.sheet.blocks.filter((b) => b.section === 's_aspects').map((b) => b.label)
    expect(aspects[0]).toBe('Mine')
    expect(aspects).toHaveLength(6)
    expect(res.sheet.blocks.filter((b) => b.section === 's_notes').map((b) => b.label)).toEqual(['Notes'])
    const ids = res.sheet.blocks.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(res.added).toBe(add.blocks.length)
    const r = parseImport(JSON.stringify(res.sheet))
    expect(r.ok && r.notes).toEqual([])
  })
  it('refuses to go over the block limit', async () => {
    const { mergeSheet } = await import('./io.ts')
    const base = buildTemplate('core', 'a')
    let sheet = base
    for (let i = 0; i < 8; i++) {
      const r = mergeSheet(sheet, buildTemplate('core', 'x'))
      if (!r.ok) { expect(r.error).toMatch(/max 300/); return }
      sheet = r.sheet
    }
    throw new Error('expected the limit to be hit')
  })
  it('withFreshIds renews block ids and only colliding section ids', async () => {
    const { withFreshIds } = await import('./io.ts')
    const t = buildTemplate('core', 'a')
    const f = withFreshIds(t, ['s_skills'])
    expect(f.blocks.every((b, i) => b.id !== t.blocks[i].id)).toBe(true)
    expect(f.sections.find((s) => s.title === 'Aspects')!.id).toBe('s_aspects')
    const skills = f.sections.find((s) => s.title === 'Skills')!.id
    expect(skills).not.toBe('s_skills')
    expect(f.blocks.filter((b) => b.section === skills)).toHaveLength(18)
  })
})
