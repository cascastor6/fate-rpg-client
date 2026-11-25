import { PROPS_BY_TYPE, type BlockProps, type BlockRow, type LogicalBlock } from './types.ts'

/** Split a logical block into its row fields (value + props). */
export function logicalToRowFields(b: LogicalBlock): Pick<BlockRow, 'id' | 'type' | 'label' | 'value' | 'section_id' | 'props'> {
  const props: BlockProps = {}
  for (const key of PROPS_BY_TYPE[b.type]) {
    if (b[key] !== undefined) (props as Record<string, unknown>)[key] = b[key]
  }
  return { id: b.id, type: b.type, label: b.label, value: b.type === 'separator' ? null : b.value, section_id: b.section, props }
}

/** Flatten a row back into a logical block (for export). */
export function rowToLogical(r: BlockRow): LogicalBlock {
  return { id: r.id, type: r.type, label: r.label, value: r.value, section: r.section_id, ...r.props }
}
