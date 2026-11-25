import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState, type ReactNode } from 'react'
import { needsRebalance, positionBetween } from '../../lib/positions.ts'
import { IconGear, IconPencil, IconPlus } from '../../ui/icons.tsx'
import { Button } from '../../ui/primitives.tsx'
import { toast } from '../../ui/toast.tsx'
import { BLOCK_TYPE_INFO } from '../defaults.ts'
import type { SheetData, SheetOpBody } from '../ops.ts'
import type { BlockRow, SectionRow } from '../types.ts'
import { AddBlockSheet, SectionSheet } from './EditSheets.tsx'
import { BlockEditor } from './BlockEditor.tsx'
import { BlockSettings } from './BlockSettings.tsx'
import { BlockView, type BlockActions } from './Blocks.tsx'

type Layout = Record<string, string[]> // section id -> block ids, in order
const DROP = 'drop:'

function GripIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[6, 12, 18].map((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
    </svg>
  )
}

function Handle({ label, ...rest }: { label: string } & Record<string, unknown>) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      className="flex w-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-[color:var(--muted)] hover:bg-black/5 active:cursor-grabbing dark:hover:bg-white/10"
    >
      <GripIcon />
    </button>
  )
}

function SortableBlock({ block, actions, onSettings, disabled }: { block: BlockRow; actions: BlockActions; onSettings: () => void; disabled: boolean }) {
  // Disabled while a section is dragged, so sections only ever land between sections.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled })
  const name = block.label || BLOCK_TYPE_INFO[block.type].name
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-stretch gap-1 rounded-xl ${isDragging ? 'opacity-30' : ''}`}
    >
      <Handle label={`Drag ${name}`} {...attributes} {...listeners} />
      <div className="min-w-0 flex-1">
        <BlockView block={block} a={actions} canRoll={false} />
      </div>
      <button
        type="button"
        onClick={onSettings}
        aria-label={`Settings for ${name}`}
        className="flex w-11 shrink-0 items-center justify-center rounded-lg text-[color:var(--muted)] hover:bg-black/5 hover:text-[color:var(--fg)] dark:hover:bg-white/10"
      >
        <IconGear className="size-5" />
      </button>
    </div>
  )
}

function EmptyDrop({ sectionId, disabled }: { sectionId: string; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP + sectionId, disabled })
  return (
    <div
      ref={setNodeRef}
      className={`mx-2 my-1 rounded-xl border-2 border-dashed px-3 py-4 text-center text-sm text-[color:var(--muted)] ${
        isOver ? 'border-amber-600' : 'border-[color:var(--border)]'
      }`}
    >
      Empty. Drop blocks here or add one.
    </div>
  )
}

function SortableSection({
  section,
  count,
  onRename,
  children,
}: {
  section: SectionRow
  count: number
  onRename: () => void
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-sm ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex min-h-12 items-stretch gap-1 border-b border-[color:var(--border)] px-1">
        <Handle label={`Drag section ${section.title}`} {...attributes} {...listeners} />
        <button type="button" onClick={onRename} className="flex flex-1 items-center gap-2 text-left" aria-label={`Rename or delete section ${section.title}`}>
          <h2 className="text-base font-bold">{section.title}</h2>
          <span className="text-sm text-[color:var(--muted)]">{count}</span>
          <IconPencil className="ml-auto mr-3 size-4 text-[color:var(--muted)]" />
        </button>
      </div>
      {children}
    </section>
  )
}

/**
 * Edit mode (SPEC §6.2): drag handles for blocks (within and across sections) and
 * sections; add / delete / retype blocks; add / rename / delete sections.
 */
export function EditSheet({ data, send }: { data: SheetData; send: (op: SheetOpBody) => void }) {
  const [valueEditing, setValueEditing] = useState<string | null>(null)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [sectionSheet, setSectionSheet] = useState<SectionRow | 'new' | null>(null)
  const [addTo, setAddTo] = useState<string | null>(null)
  const [live, setLive] = useState<Layout | null>(null)
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const base = useMemo<Layout>(() => {
    const l: Layout = {}
    for (const s of data.sections) l[s.id] = []
    for (const b of data.blocks) (l[b.section_id] ??= []).push(b.id)
    return l
  }, [data])
  const layout = live ?? base
  const blockById = useMemo(() => new Map(data.blocks.map((b) => [b.id, b])), [data.blocks])
  const sectionIds = data.sections.map((s) => s.id)
  const draggingSection = activeId !== null && sectionIds.includes(String(activeId))

  const containerOf = (id: UniqueIdentifier, l: Layout): string | undefined => {
    const s = String(id)
    if (s.startsWith(DROP)) return s.slice(DROP.length)
    if (s in l) return s
    return Object.keys(l).find((k) => l[k].includes(s))
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id)
    if (!sectionIds.includes(String(active.id))) setLive(base)
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !live || sectionIds.includes(String(active.id))) return
    const from = containerOf(active.id, live)
    const to = containerOf(over.id, live)
    if (!from || !to || from === to) return
    setLive((l) => {
      if (!l) return l
      const fromList = l[from].filter((x) => x !== active.id)
      const toList = [...l[to]]
      const overIndex = toList.indexOf(String(over.id))
      toList.splice(overIndex >= 0 ? overIndex : toList.length, 0, String(active.id))
      return { ...l, [from]: fromList, [to]: toList }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    const activeKey = String(active.id)

    // Section reorder
    if (sectionIds.includes(activeKey)) {
      setLive(null)
      if (!over || over.id === active.id) return
      const overKey = containerOf(over.id, base) ?? String(over.id)
      const from = sectionIds.indexOf(activeKey)
      const to = sectionIds.indexOf(overKey)
      if (to < 0 || from === to) return
      const order = arrayMove(data.sections, from, to)
      const i = order.findIndex((s) => s.id === activeKey)
      const before = order[i - 1]?.position
      const after = order[i + 1]?.position
      send({ kind: 'patch_section', sectionId: activeKey, patch: { position: positionBetween(before, after) } })
      if (needsRebalance(before, after)) send({ kind: 'rebalance' })
      return
    }

    // Block move
    const l = live ?? base
    setLive(null)
    if (!over) return
    const container = containerOf(active.id, l)
    if (!container) return
    let list = l[container]
    const overKey = String(over.id)
    if (list.includes(overKey) && overKey !== activeKey) {
      list = arrayMove(list, list.indexOf(activeKey), list.indexOf(overKey))
    }
    const i = list.indexOf(activeKey)
    const block = blockById.get(activeKey)
    if (!block || i < 0) return
    const before = blockById.get(list[i - 1])?.position
    const after = blockById.get(list[i + 1])?.position
    const unchanged = container === block.section_id && base[container].indexOf(activeKey) === i
    if (unchanged) return
    send({ kind: 'patch', blockId: activeKey, patch: { section_id: container, position: positionBetween(before, after) } })
    if (needsRebalance(before, after)) send({ kind: 'rebalance' })
  }

  const deleteBlock = (b: BlockRow) => {
    setSettingsFor(null)
    send({ kind: 'delete_block', blockId: b.id })
    toast(`Deleted “${b.label || BLOCK_TYPE_INFO[b.type].name}”.`, 'info', 6000, {
      label: 'Undo',
      onClick: () => send({ kind: 'insert_block', block: { ...b, version: 0 } }),
    })
  }

  const actions: BlockActions = {
    canEdit: true,
    edit: (b) => (b.type === 'separator' ? setSettingsFor(b.id) : setValueEditing(b.id)),
    roll: () => {},
    send,
  }

  const activeBlock = activeId ? blockById.get(String(activeId)) : undefined
  const activeSection = activeId ? data.sections.find((s) => s.id === activeId) : undefined
  const valueBlock = valueEditing ? blockById.get(valueEditing) : undefined
  const settingsBlock = settingsFor ? blockById.get(settingsFor) : undefined

  return (
    <div className="flex flex-col gap-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setLive(null); setActiveId(null) }}
        // Sections collapse to their headers while one is dragged, so re-measure as layout changes.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        // Smaller edge zone than the default 20%: the fixed bottom bar already covers the
        // bottom of the screen, and a drag starting just above it shouldn't scroll away.
        autoScroll={{ threshold: { x: 0, y: 0.1 }, acceleration: 6 }}
      >
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          {data.sections.map((section) => {
            const ids = layout[section.id] ?? []
            return (
              <SortableSection key={section.id} section={section} count={ids.length} onRename={() => setSectionSheet(section)}>
                {draggingSection ? null : <>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-0.5 p-1">
                    {ids.map((id) => {
                      const b = blockById.get(id)
                      return b ? <SortableBlock key={id} block={b} actions={actions} disabled={draggingSection} onSettings={() => setSettingsFor(id)} /> : null
                    })}
                    {ids.length === 0 && <EmptyDrop sectionId={section.id} disabled={draggingSection} />}
                  </div>
                </SortableContext>
                <div className="px-2 pb-2">
                  <Button variant="ghost" className="w-full border border-dashed border-[color:var(--border)]" onClick={() => setAddTo(section.id)}>
                    <IconPlus className="size-4" /> Add block
                  </Button>
                </div>
                </>}
              </SortableSection>
            )
          })}
        </SortableContext>
        <DragOverlay>
          {activeBlock ? (
            <div className="rounded-xl border border-amber-600 bg-[color:var(--card)] px-4 py-3 font-semibold shadow-xl">
              {activeBlock.label || BLOCK_TYPE_INFO[activeBlock.type].name}
            </div>
          ) : activeSection ? (
            <div className="rounded-2xl border border-amber-600 bg-[color:var(--card)] px-4 py-3 font-bold shadow-xl">{activeSection.title}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Button variant="secondary" onClick={() => setSectionSheet('new')} disabled={data.sections.length >= 30}>
        <IconPlus className="size-4" /> Add section
      </Button>

      {valueBlock && <BlockEditor key={valueBlock.id} block={valueBlock} send={send} onClose={() => setValueEditing(null)} />}
      {settingsBlock && (
        <BlockSettings key={settingsBlock.id} block={settingsBlock} send={send} onClose={() => setSettingsFor(null)} onDelete={deleteBlock} />
      )}
      {sectionSheet && (
        <SectionSheet
          data={data}
          section={sectionSheet === 'new' ? null : sectionSheet}
          send={send}
          onClose={() => setSectionSheet(null)}
        />
      )}
      {addTo && (
        <AddBlockSheet
          data={data}
          sectionId={addTo}
          send={send}
          onClose={() => setAddTo(null)}
          onAdded={(id) => { setAddTo(null); setSettingsFor(id) }}
        />
      )}
    </div>
  )
}
