// .fate.json export / import (SPEC §5.6).

import { byPosition, POSITION_STEP } from '../lib/positions.ts'
import { logicalToRowFields, rowToLogical } from './convert.ts'
import { newBlockId, newSectionId } from './ids.ts'
import type { SheetData } from './ops.ts'
import type { BlockRow, CharacterRow, LogicalBlock, LogicalSection, SectionRow, SheetJson, TemplateId } from './types.ts'
import { blockProblem } from './validate.ts'

export const MAX_BLOCKS = 300
export const MAX_SECTIONS = 30

export function exportSheet(data: SheetData): SheetJson {
  const sections = [...data.sections].sort(byPosition)
  const order = new Map(sections.map((s, i) => [s.id, i]))
  const blocks = [...data.blocks].sort((a, b) => (order.get(a.section_id) ?? 1e9) - (order.get(b.section_id) ?? 1e9) || byPosition(a, b))
  const c = data.character
  return {
    format: 'fate-table-sheet',
    version: 1,
    kind: c.kind,
    name: c.name,
    template: c.template,
    fate_points: c.fate_points,
    refresh: c.refresh,
    sections: sections.map((s) => ({ id: s.id, title: s.title })),
    blocks: blocks.map(rowToLogical),
  }
}

export function exportFileName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character'
  return `${slug}.fate.json`
}

export type ImportResult =
  | { ok: true; sheet: SheetJson; notes: string[] }
  | { ok: false; error: string }

const TEMPLATES: TemplateId[] = ['core', 'accelerated', 'condensed', 'blank', 'npc']

/**
 * Parse and check a .fate.json file. Problems that can be fixed safely (duplicate or
 * malformed ids, blocks pointing at a missing section) are fixed and reported in notes;
 * anything else is an error and nothing is imported.
 */
export function parseImport(text: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON.' }
  }
  return parseSheetObject(raw)
}

/** Validate one already-parsed sheet object (see parseImport). */
export function parseSheetObject(raw: unknown): ImportResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'That file isn’t a character sheet.' }
  const r = raw as Record<string, unknown>
  if (r.format !== 'fate-table-sheet') return { ok: false, error: 'That file isn’t a Fate Table sheet (missing "format").' }
  if (!Array.isArray(r.sections) || !Array.isArray(r.blocks)) return { ok: false, error: 'The file has no sections or blocks.' }
  if (r.sections.length > MAX_SECTIONS) return { ok: false, error: `Too many sections (max ${MAX_SECTIONS}).` }
  if (r.blocks.length > MAX_BLOCKS) return { ok: false, error: `Too many blocks (max ${MAX_BLOCKS}).` }

  const notes: string[] = []
  const sectionIds = new Map<string, string>() // old id -> new id
  const sections: LogicalSection[] = []
  for (const [i, s] of (r.sections as unknown[]).entries()) {
    const sec = s as Record<string, unknown>
    const title = typeof sec?.title === 'string' ? sec.title.trim().slice(0, 60) : ''
    if (!title) return { ok: false, error: `Section ${i + 1} has no title.` }
    let id = typeof sec.id === 'string' ? sec.id : ''
    if (!/^s_[a-z0-9_]{3,32}$/.test(id) || sections.some((x) => x.id === id)) {
      id = newSectionId()
      notes.push(`Gave section “${title}” a new id.`)
    }
    if (typeof sec.id === 'string') sectionIds.set(sec.id, id)
    sections.push({ id, title })
  }

  const blocks: LogicalBlock[] = []
  const seen = new Set<string>()
  let orphaned = 0
  for (const [i, b] of (r.blocks as unknown[]).entries()) {
    if (typeof b !== 'object' || b === null) return { ok: false, error: `Block ${i + 1} is not an object.` }
    const { id, type, label, value, section, ...props } = b as Record<string, unknown>
    const problem = blockProblem(String(type), value ?? (type === 'separator' ? null : value), props)
    if (problem) return { ok: false, error: `Block ${i + 1} (${typeof label === 'string' && label ? label : type}): ${problem}.` }
    let bid = typeof id === 'string' ? id : ''
    if (!/^b_[a-z0-9]{6,32}$/.test(bid) || seen.has(bid)) {
      bid = newBlockId()
      notes.push(`Block ${i + 1} got a new id.`)
    }
    seen.add(bid)
    let sid = typeof section === 'string' ? sectionIds.get(section) : undefined
    if (!sid) {
      orphaned++
      if (!sections.some((s) => s.id === 's_imported')) sections.push({ id: 's_imported', title: 'Imported' })
      sid = 's_imported'
    }
    blocks.push({
      id: bid, type: type as LogicalBlock['type'], label: typeof label === 'string' ? label.slice(0, 200) : '',
      value: type === 'separator' ? null : (value as LogicalBlock['value']), section: sid, ...props,
    } as LogicalBlock)
  }
  if (orphaned) notes.push(`${orphaned} block(s) without a matching section were put under “Imported”.`)
  if (sections.length > MAX_SECTIONS) return { ok: false, error: `Too many sections (max ${MAX_SECTIONS}).` }

  const int = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : d)
  return {
    ok: true,
    notes,
    sheet: {
      format: 'fate-table-sheet',
      version: 1,
      kind: r.kind === 'npc' || r.kind === 'template' ? r.kind : 'pc',
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : 'Imported character',
      template: TEMPLATES.includes(r.template as TemplateId) ? (r.template as TemplateId) : 'blank',
      fate_points: int(r.fate_points, 3),
      refresh: int(r.refresh, 3),
      sections,
      blocks,
    },
  }
}

/** Rows that replace_sheet will produce, for the optimistic preview. */
export function sheetToRows(sheet: SheetJson, characterId: string): { sections: SectionRow[]; blocks: BlockRow[]; character: Partial<CharacterRow> } {
  return {
    character: { name: sheet.name, template: sheet.template, fate_points: sheet.fate_points, refresh: sheet.refresh },
    sections: sheet.sections.map((s, i) => ({ character_id: characterId, id: s.id, title: s.title, position: (i + 1) * POSITION_STEP, version: 0 })),
    blocks: sheet.blocks.map((b, i) => ({ ...logicalToRowFields(b), character_id: characterId, position: (i + 1) * POSITION_STEP, version: 0 })),
  }
}

/** Fresh block ids (and section ids that collide with `avoid`) so a copy never clashes. */
export function withFreshIds(sheet: SheetJson, avoidSectionIds: Iterable<string> = []): SheetJson {
  const avoid = new Set(avoidSectionIds)
  const sectionMap = new Map<string, string>()
  const sections = sheet.sections.map((s) => {
    const id = avoid.has(s.id) ? newSectionId() : s.id
    sectionMap.set(s.id, id)
    return { ...s, id }
  })
  return {
    ...sheet,
    sections,
    blocks: sheet.blocks.map((b) => ({ ...b, id: newBlockId(), section: sectionMap.get(b.section) ?? b.section })),
  }
}

export type MergeResult = { ok: true; sheet: SheetJson; added: number } | { ok: false; error: string }

/**
 * Add a template's sections and blocks to an existing sheet (SPEC §6.2). Template sections
 * whose title matches an existing section (ignoring case) go into that section, after its
 * blocks; other sections are appended. Everything already on the sheet is kept as is.
 */
export function mergeSheet(base: SheetJson, add: SheetJson): MergeResult {
  const key = (t: string) => t.trim().toLowerCase()
  const byTitle = new Map(base.sections.map((s) => [key(s.title), s.id]))
  const fresh = withFreshIds(add, base.sections.map((s) => s.id))
  const target = new Map<string, string>() // added section id -> final section id
  const sections = [...base.sections]
  for (const s of fresh.sections) {
    const existing = byTitle.get(key(s.title))
    if (existing) target.set(s.id, existing)
    else {
      sections.push(s)
      byTitle.set(key(s.title), s.id)
      target.set(s.id, s.id)
    }
  }
  const added = fresh.blocks.map((b) => ({ ...b, section: target.get(b.section) ?? b.section }))
  if (sections.length > MAX_SECTIONS) return { ok: false, error: `That would make ${sections.length} sections (max ${MAX_SECTIONS}).` }
  if (base.blocks.length + added.length > MAX_BLOCKS) {
    return { ok: false, error: `That would make ${base.blocks.length + added.length} blocks (max ${MAX_BLOCKS}).` }
  }
  // Keep blocks grouped by section, in section order, existing ones first.
  const blocks = sections.flatMap((s) => [
    ...base.blocks.filter((b) => b.section === s.id),
    ...added.filter((b) => b.section === s.id),
  ])
  return { ok: true, sheet: { ...base, sections, blocks }, added: added.length }
}

// ---- template bundles (SPEC §5.7): what "Delete session" downloads ----------------------

export const TEMPLATE_BUNDLE_FORMAT = 'fate-table-templates'
export type TemplateBundle = {
  format: typeof TEMPLATE_BUNDLE_FORMAT
  version: 1
  session_name: string
  exported_at: string
  templates: (SheetJson & { offered: boolean })[]
}

export function templateBundle(sessionName: string, templates: { sheet: SheetJson; offered: boolean }[], now = new Date()): TemplateBundle {
  return {
    format: TEMPLATE_BUNDLE_FORMAT,
    version: 1,
    session_name: sessionName,
    exported_at: now.toISOString(),
    templates: templates.map((t) => ({ ...t.sheet, kind: 'template' as const, offered: t.offered })),
  }
}

export type TemplatesImport =
  | { ok: true; templates: { sheet: SheetJson; offered: boolean }[]; notes: string[] }
  | { ok: false; error: string }

/** Accepts a template bundle, or a single .fate.json sheet (imported as one template). */
export function parseTemplatesFile(text: string): TemplatesImport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON.' }
  }
  const r = raw as Record<string, unknown> | null
  const items: unknown[] = r && r.format === TEMPLATE_BUNDLE_FORMAT && Array.isArray(r.templates) ? r.templates : [raw]
  if (items.length === 0) return { ok: false, error: 'That file has no templates in it.' }
  if (items.length > 50) return { ok: false, error: 'That file has more than 50 templates.' }
  const out: { sheet: SheetJson; offered: boolean }[] = []
  const notes: string[] = []
  for (const [i, item] of items.entries()) {
    const res = parseSheetObject(item)
    if (!res.ok) return { ok: false, error: items.length > 1 ? `Template ${i + 1}: ${res.error}` : res.error }
    out.push({ sheet: { ...res.sheet, kind: 'template' }, offered: (item as Record<string, unknown>).offered === true })
    notes.push(...res.notes.map((n) => (items.length > 1 ? `${res.sheet.name}: ${n}` : n)))
  }
  return { ok: true, templates: out, notes }
}
