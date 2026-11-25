import { useMemo, useState } from 'react'
import { readJson, writeJson } from '../../lib/storage.ts'
import { IconChevron } from '../../ui/icons.tsx'
import type { SheetData, SheetOpBody } from '../ops.ts'
import type { BlockRow, SectionRow } from '../types.ts'
import { BlockEditor } from './BlockEditor.tsx'
import { BlockView, type BlockActions } from './Blocks.tsx'

const collapsedKey = (characterId: string) => `fate.collapsed.${characterId}`

/** Which sections are collapsed on this device (SPEC §5.1). Skill-heavy sections start collapsed on phones. */
function useCollapsed(characterId: string, sections: SectionRow[], blocks: BlockRow[]) {
  const [stored, setStored] = useState<Record<string, boolean> | null>(() => readJson(collapsedKey(characterId)))
  const defaults = useMemo(() => {
    const narrow = typeof window !== 'undefined' && window.innerWidth < 640
    const d: Record<string, boolean> = {}
    for (const s of sections) {
      const skills = blocks.filter((b) => b.section_id === s.id && b.type === 'skill').length
      d[s.id] = narrow && skills > 8
    }
    return d
  }, [sections, blocks])
  const isCollapsed = (id: string) => stored?.[id] ?? defaults[id] ?? false
  const toggle = (id: string) => {
    const next = { ...defaults, ...stored, [id]: !isCollapsed(id) }
    setStored(next)
    writeJson(collapsedKey(characterId), next)
  }
  return { isCollapsed, toggle }
}

export function SheetView({
  data,
  canEdit,
  canRoll,
  send,
  onRoll,
}: {
  data: SheetData
  canEdit: boolean
  canRoll: boolean
  send: (op: SheetOpBody) => void
  onRoll: (block: BlockRow) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const { isCollapsed, toggle } = useCollapsed(data.character.id, data.sections, data.blocks)

  const grouped = useMemo(() => {
    const known = new Set(data.sections.map((s) => s.id))
    const groups = data.sections.map((s) => ({ section: s, blocks: data.blocks.filter((b) => b.section_id === s.id) }))
    const orphans = data.blocks.filter((b) => !known.has(b.section_id))
    if (orphans.length) {
      groups.push({ section: { id: '__other', title: 'Other', character_id: data.character.id, position: Infinity, version: 0 }, blocks: orphans })
    }
    return groups
  }, [data])

  const actions: BlockActions = {
    canEdit,
    edit: (b) => setEditing(b.id),
    roll: onRoll,
    send,
  }
  const editingBlock = editing ? data.blocks.find((b) => b.id === editing) : undefined

  return (
    <div className="flex flex-col gap-3">
      {grouped.map(({ section, blocks }) => {
        const collapsed = isCollapsed(section.id)
        return (
          <section key={section.id} className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-sm">
            <h2>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-2 px-4 text-left"
                aria-expanded={!collapsed}
                onClick={() => toggle(section.id)}
              >
                <span className="flex-1 text-base font-bold">{section.title}</span>
                {collapsed && <span className="text-sm text-[color:var(--muted)]">{blocks.length}</span>}
                <IconChevron className={`size-5 text-[color:var(--muted)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
              </button>
            </h2>
            {!collapsed && (
              <div className="flex flex-col gap-0.5 px-1 pb-2">
                {blocks.map((b) => (
                  <BlockView key={b.id} block={b} a={actions} canRoll={canRoll} />
                ))}
                {blocks.length === 0 && <p className="px-3 py-2 text-sm italic text-[color:var(--muted)]">Nothing here yet.</p>}
              </div>
            )}
          </section>
        )
      })}
      {editingBlock && <BlockEditor key={editingBlock.id} block={editingBlock} send={send} onClose={() => setEditing(null)} />}
    </div>
  )
}
