// Where starting sheets come from: the built-in templates, plus templates the GM made
// in this session (characters with kind 'template', SPEC §5.7).

import { supabase } from '../lib/supabase.ts'
import { exportSheet, withFreshIds } from './io.ts'
import { buildTemplate, TEMPLATES } from './templates.ts'
import { BLOCK_COLUMNS, CHARACTER_COLUMNS, SECTION_COLUMNS, type BlockRow, type CharacterRow, type SectionRow, type SheetJson, type TemplateId } from './types.ts'

export type TemplateChoice =
  | { source: 'builtin'; key: string; id: Exclude<TemplateId, 'npc'>; name: string; blurb: string }
  | { source: 'session'; key: string; character: CharacterRow; name: string; blurb: string }

/** Built-ins plus session templates the viewer may use (players: offered ones; GM: all). */
export function templateChoices(characters: CharacterRow[], isGm: boolean): { gm: TemplateChoice[]; builtin: TemplateChoice[] } {
  const gm = characters
    .filter((c) => c.kind === 'template' && (isGm || c.visible_to_players))
    .map<TemplateChoice>((c) => ({
      source: 'session', key: `s:${c.id}`, character: c, name: c.name,
      blurb: isGm ? (c.visible_to_players ? 'Offered to players' : 'Draft (only you can see it)') : 'Made by your GM',
    }))
  const builtin = TEMPLATES.map<TemplateChoice>((t) => ({ source: 'builtin', key: `b:${t.id}`, id: t.id, name: t.name, blurb: t.blurb }))
  return { gm, builtin }
}

/** Fetch a session template's sheet as a §5.6 sheet (with its own ids). */
export async function fetchTemplateSheet(characterId: string): Promise<SheetJson> {
  const [c, s, b] = await Promise.all([
    supabase.from('characters').select(CHARACTER_COLUMNS).eq('id', characterId).single<CharacterRow>(),
    supabase.from('sheet_sections').select(SECTION_COLUMNS).eq('character_id', characterId).returns<SectionRow[]>(),
    supabase.from('sheet_blocks').select(BLOCK_COLUMNS).eq('character_id', characterId).returns<BlockRow[]>(),
  ])
  const err = c.error ?? s.error ?? b.error
  if (err) throw err
  return exportSheet({ character: c.data!, sections: s.data ?? [], blocks: b.data ?? [] })
}

/** A ready-to-create PC sheet from a choice, with fresh block ids. */
export async function sheetFromChoice(choice: TemplateChoice, name: string): Promise<SheetJson> {
  if (choice.source === 'builtin') return buildTemplate(choice.id, name)
  const t = await fetchTemplateSheet(choice.character.id)
  // A PC made from a GM template records the template's base (core, blank, ...).
  return withFreshIds({ ...t, kind: 'pc', name, template: t.template === 'npc' ? 'blank' : t.template })
}
