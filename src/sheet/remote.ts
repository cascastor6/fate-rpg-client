// Folding realtime changes into a sheet's server copy (SPEC §6.3, §10).
// INSERTs always win (a replace_sheet deletes and re-inserts rows with fresh versions);
// UPDATEs only win if their version is newer; DELETEs carry just the primary key.

import { byPosition } from '../lib/positions.ts'
import type { SheetData } from './ops.ts'
import type { BlockRow, CharacterRow, SectionRow } from './types.ts'

export type ChangeType = 'INSERT' | 'UPDATE' | 'DELETE'

export type RemoteChange =
  | { table: 'sheet_blocks'; type: ChangeType; row: Partial<BlockRow> }
  | { table: 'sheet_sections'; type: ChangeType; row: Partial<SectionRow> }
  | { table: 'characters'; type: ChangeType; row: Partial<CharacterRow> }

/** Insert / version-gated update / delete of one row in a keyed list. */
export function upsertRow<T extends { id: string; version: number }>(list: T[], type: ChangeType, row: Partial<T>): T[] {
  const i = list.findIndex((x) => x.id === row.id)
  if (type === 'DELETE') return i < 0 ? list : list.filter((_, j) => j !== i)
  const full = row as T
  if (i < 0) return [...list, full]
  if (type === 'UPDATE' && list[i].version >= full.version) return list
  const next = [...list]
  next[i] = full
  return next
}

/** Returns the new server copy, or the same object if the change doesn't apply. */
export function mergeRemote(data: SheetData, change: RemoteChange): SheetData {
  const cid = data.character.id
  switch (change.table) {
    case 'sheet_blocks': {
      if (change.row.character_id !== cid) return data
      const blocks = upsertRow(data.blocks, change.type, change.row)
      return blocks === data.blocks ? data : { ...data, blocks: blocks.sort(byPosition) }
    }
    case 'sheet_sections': {
      if (change.row.character_id !== cid) return data
      const sections = upsertRow(data.sections, change.type, change.row)
      return sections === data.sections ? data : { ...data, sections: sections.sort(byPosition) }
    }
    case 'characters': {
      if (change.row.id !== cid || change.type === 'DELETE') return data
      const row = change.row as CharacterRow
      if (change.type === 'UPDATE' && data.character.version >= row.version) return data
      return { ...data, character: row }
    }
  }
}
