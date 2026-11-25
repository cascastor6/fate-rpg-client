// Sheet model (SPEC §5). The client works with rows as stored (value + props);
// templates and export use the flat "logical" block format.

export const BLOCK_TYPES = [
  'text', 'aspect', 'skill', 'stress', 'consequence', 'counter', 'number', 'image', 'separator',
] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export type StressBox = { size: number; checked: boolean; disabled?: boolean }
export type AspectRole = 'high_concept' | 'trouble' | 'other'

/** Type-specific extra fields, stored in sheet_blocks.props. */
export type BlockProps = {
  hint?: string
  multiline?: boolean
  role?: AspectRole
  rollable?: boolean
  shift?: number
  free_invokes?: number
  max?: number
  refresh?: number
  alt?: string
}

/** Allowed props keys per type (mirrors private.validate_block). */
export const PROPS_BY_TYPE: Record<BlockType, readonly (keyof BlockProps)[]> = {
  text: ['hint', 'multiline'],
  aspect: ['hint', 'role'],
  skill: ['hint', 'rollable'],
  stress: ['hint'],
  consequence: ['hint', 'shift', 'free_invokes'],
  counter: ['hint', 'max', 'refresh'],
  number: ['hint'],
  image: ['hint', 'alt'],
  separator: ['hint'],
}

export type BlockValue = string | number | StressBox[] | null

/** A row of public.sheet_blocks. */
export type BlockRow = {
  character_id: string
  id: string
  section_id: string
  type: BlockType
  label: string
  value: BlockValue
  props: BlockProps
  position: number
  version: number
}

/** A row of public.sheet_sections. */
export type SectionRow = {
  character_id: string
  id: string
  title: string
  position: number
  version: number
}

export type TemplateId = 'core' | 'accelerated' | 'condensed' | 'blank' | 'npc'

/** A row of public.characters. */
export type CharacterKind = 'pc' | 'npc' | 'template'

export type CharacterRow = {
  id: string
  session_id: string
  /** 'template' = a GM-made starting sheet players can pick (SPEC §5.7) */
  kind: CharacterKind
  owner_id: string | null
  name: string
  template: TemplateId
  fate_points: number
  refresh: number
  visible_to_players: boolean
  position: number
  version: number
}

/** Logical (flat) block, as in templates and .fate.json exports (SPEC §5.2). */
export type LogicalBlock = {
  id: string
  type: BlockType
  label: string
  value: BlockValue
  section: string
} & BlockProps

export type LogicalSection = { id: string; title: string }

/** The sheet format accepted by create_character / replace_sheet and used for export. */
export type SheetJson = {
  format?: 'fate-table-sheet'
  version?: 1
  kind: CharacterKind
  name: string
  template: TemplateId
  fate_points: number
  refresh: number
  sections: LogicalSection[]
  blocks: LogicalBlock[]
}

export const CHARACTER_COLUMNS = 'id,session_id,kind,owner_id,name,template,fate_points,refresh,visible_to_players,position,version'
export const BLOCK_COLUMNS = 'character_id,id,section_id,type,label,value,props,position,version'
export const SECTION_COLUMNS = 'character_id,id,title,position,version'
