import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDice } from '../dice/useDice.ts'
import { useSpotlight } from '../gm/spotlight.ts'
import { friendlyError } from '../lib/errors.ts'
import { positionBetween } from '../lib/positions.ts'
import { supabase } from '../lib/supabase.ts'
import { clampToken } from '../scenes/boardMath.ts'
import { useScenes, type SceneRow } from '../scenes/store.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { BlockEditor } from '../sheet/components/BlockEditor.tsx'
import { SkillBlock, type BlockActions } from '../sheet/components/Blocks.tsx'
import { defaultBlock } from '../sheet/defaults.ts'
import { newBlockId } from '../sheet/ids.ts'
import { exportSheet, withFreshIds } from '../sheet/io.ts'
import { buildTemplate } from '../sheet/templates.ts'
import type { BlockRow, CharacterRow } from '../sheet/types.ts'
import { useSheet } from '../sheet/useSheet.ts'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { IconPencil } from '../ui/icons.tsx'
import { Button, Spinner } from '../ui/primitives.tsx'
import { toast } from '../ui/toast.tsx'

/** NPC roster (SPEC §8.3.5). `boardScene` is the zones scene open in the editor, if any. */
export function NpcRoster({ boardScene }: { boardScene: SceneRow | null }) {
  const { session, characters, refresh } = useSession()
  const [query, setQuery] = useState('')
  const npcs = characters.filter((c) => c.kind === 'npc')
  const shown = npcs.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const create = async () => {
    const sheet = { ...buildTemplate('npc', 'New NPC'), position: positionBetween(npcs.at(-1)?.position, null) }
    const { error } = await supabase.rpc('create_character', { p_session_id: session.id, p_sheet: sheet })
    if (error) toast(friendlyError(error), 'error')
    else await refresh()
  }
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || query) return
    const order = arrayMove(npcs, npcs.findIndex((c) => c.id === active.id), npcs.findIndex((c) => c.id === over.id))
    const i = order.findIndex((c) => c.id === active.id)
    const { error } = await supabase.from('characters').update({ position: positionBetween(order[i - 1]?.position, order[i + 1]?.position) }).eq('id', String(active.id))
    if (error) toast(friendlyError(error), 'error')
    await refresh()
  }

  return (
    <section aria-label="NPCs" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 px-1 text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">NPCs ({npcs.length})</h2>
        <Button onClick={() => void create()}>+ New NPC</Button>
      </div>
      {npcs.length > 3 && (
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search NPCs…" aria-label="Search NPCs"
          className="min-h-11 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3" />
      )}
      {npcs.length === 0 && <p className="rounded-xl border border-dashed border-[color:var(--border)] p-4 text-center text-sm text-[color:var(--muted)]">No NPCs yet.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
        <SortableContext items={shown.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-3">
            {shown.map((c) => <NpcCard key={c.id} npc={c} boardScene={boardScene} />)}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  )
}

function NpcCard({ npc, boardScene }: { npc: CharacterRow; boardScene: SceneRow | null }) {
  const { session, refresh } = useSession()
  const { snapshot, enqueue } = useSheet(npc.id)
  const dice = useDice()
  const spotlight = useSpotlight()
  const scenes = useScenes(session.id)
  const sortable = useSortable({ id: npc.id })
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)

  if (snapshot.status !== 'ready') {
    return <li aria-label={`NPC ${npc.name}`} aria-busy="true" className="flex min-h-24 items-center justify-center rounded-2xl border border-[color:var(--border)]"><Spinner className="size-5" /></li>
  }
  const { data } = snapshot
  const aspects = data.blocks.filter((b) => b.type === 'aspect')
  const skills = data.blocks.filter((b) => b.type === 'skill')

  const ensureSection = (id: string, title: string) => {
    if (!data.sections.some((s) => s.id === id)) {
      enqueue({ kind: 'insert_section', section: { character_id: npc.id, id, title, position: positionBetween(data.sections.at(-1)?.position, null), version: 0 } })
    }
  }
  const addBlock = (type: 'aspect' | 'skill') => {
    const sectionId = type === 'aspect' ? 's_aspects' : 's_skills'
    ensureSection(sectionId, type === 'aspect' ? 'Aspects' : 'Skills')
    const last = data.blocks.filter((b) => b.section_id === sectionId).at(-1)
    const id = newBlockId()
    const d = defaultBlock(type)
    enqueue({ kind: 'insert_block', block: { character_id: npc.id, id, section_id: sectionId, type, ...d, position: positionBetween(last?.position, null), version: 0 } })
    setEditing(id) // a new skill needs a name straight away
  }
  const setVisible = async (v: boolean) => {
    const { error } = await supabase.from('characters').update({ visible_to_players: v }).eq('id', npc.id)
    if (error) return toast(friendlyError(error), 'error')
    await refresh()
  }
  const duplicate = async () => {
    setMenu(false)
    const base = npc.name.replace(/\s+\d+$/, '')
    const sheet = withFreshIds({ ...exportSheet(data), kind: 'npc', name: `${base} 2`.slice(0, 80) })
    const { error } = await supabase.rpc('create_character', { p_session_id: session.id, p_sheet: { ...sheet, position: npc.position + 0.5 } })
    if (error) return toast(friendlyError(error), 'error')
    await refresh()
  }
  const remove = async () => {
    setMenu(false)
    if (!window.confirm(`Delete ${npc.name}? This can’t be undone.`)) return
    const { error } = await supabase.from('characters').delete().eq('id', npc.id)
    if (error) return toast(friendlyError(error), 'error')
    await refresh()
  }
  const addToBoard = () => {
    setMenu(false)
    if (!boardScene) return
    void scenes.store.addTokens(boardScene.id, [{ character_id: npc.id, label: npc.name.slice(0, 40), color: 'slate', ...clampToken({ x: 800 + Math.random() * 80 - 40, y: 500 + Math.random() * 80 - 40 }) }])
    toast(`${npc.name} added to ${boardScene.name}.`)
  }

  const actions: BlockActions = {
    canEdit: true,
    edit: (b) => setEditing(b.id),
    roll: (b) => void dice.store.roll({ characterId: npc.id, blockId: b.id }),
    send: enqueue,
  }
  const editingBlock = editing ? data.blocks.find((b) => b.id === editing) : undefined
  const text = (b: BlockRow) => (typeof b.value === 'string' ? b.value.trim() : '')
  const onBoard = boardScene && scenes.contents[boardScene.id]?.tokens.some((t) => t.character_id === npc.id)

  return (
    <li ref={sortable.setNodeRef} style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={`rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-sm ${sortable.isDragging ? 'opacity-50' : ''}`} aria-label={`NPC ${npc.name}`}>
      <header className="flex items-center gap-1 border-b border-[color:var(--border)] px-1 py-1">
        <button type="button" {...sortable.attributes} {...sortable.listeners} aria-label={`Drag ${npc.name}`}
          className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center text-[color:var(--muted)]">⠿</button>
        <button type="button" onClick={() => setRenaming(true)} className="min-h-11 min-w-0 flex-1 truncate text-left text-lg font-bold" aria-label={`Rename ${npc.name}`}>
          {npc.name}
        </button>
        <button type="button" onClick={() => void setVisible(!npc.visible_to_players)} aria-pressed={npc.visible_to_players}
          aria-label={npc.visible_to_players ? `Hide ${npc.name} from players` : `Show ${npc.name} to players`}
          title={npc.visible_to_players ? 'Players can see this NPC' : 'Hidden from players'}
          className={`flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold ${npc.visible_to_players ? 'text-green-700 dark:text-green-400' : 'text-[color:var(--muted)]'}`}>
          {npc.visible_to_players ? '👁 Shown' : '◌ Hidden'}
        </button>
        <button type="button" onClick={() => setMenu(true)} aria-label={`${npc.name} options`} className="flex size-11 items-center justify-center rounded-lg text-xl font-bold">⋯</button>
      </header>
      <div className="flex flex-col gap-1 p-2">
        <ul>
          {aspects.map((b) => {
            const t = text(b)
            const lit = spotlight.isBlockLit(npc.id, b.id)
            return (
              <li key={b.id} className="flex items-stretch gap-1 rounded-lg" style={lit ? { outline: '3px solid #d97706' } : undefined}>
                <button type="button" onClick={() => setEditing(b.id)} className="min-h-11 min-w-0 flex-1 rounded-lg px-2 text-left hover:bg-black/5 dark:hover:bg-white/5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">{b.label || 'Aspect'}</span>
                  <span className={`block leading-snug ${t ? 'font-semibold' : 'italic text-[color:var(--muted)]'}`}>{t || 'Tap to write an aspect'}</span>
                </button>
                {t && (
                  <button type="button" onClick={() => void spotlight.toggleBlock(npc.id, b.id)} aria-pressed={lit}
                    aria-label={`${lit ? 'Clear highlight on' : 'Highlight for everyone:'} ${t}`}
                    className={`flex w-10 items-center justify-center text-lg ${lit ? 'text-amber-600' : 'text-[color:var(--muted)] opacity-60 hover:opacity-100'}`}>★</button>
                )}
              </li>
            )
          })}
        </ul>
        <div className="flex flex-col">{skills.map((b) => <SkillBlock key={b.id} block={b} a={actions} canRoll />)}</div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="ghost" className="border border-dashed border-[color:var(--border)] text-sm" onClick={() => addBlock('aspect')}>+ Aspect</Button>
          <Button variant="ghost" className="border border-dashed border-[color:var(--border)] text-sm" onClick={() => addBlock('skill')}>+ Skill</Button>
        </div>
      </div>
      {editingBlock && <BlockEditor key={editingBlock.id} block={editingBlock} send={enqueue} onClose={() => setEditing(null)} />}
      {renaming && <Rename npc={npc} onSave={(name) => enqueue({ kind: 'character', patch: { name } })} onClose={() => setRenaming(false)} />}
      {menu && (
        <BottomSheet open title={npc.name} onDismiss={() => setMenu(false)}>
          <div className="flex flex-col gap-2">
            <Link to={`/s/${session.id}/c/${npc.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[color:var(--border)] px-4 font-medium">
              <IconPencil className="mr-2 size-4" /> Open full sheet (stress, consequences, export…)
            </Link>
            <Button variant="secondary" onClick={addToBoard} disabled={!boardScene || !!onBoard}>
              {!boardScene ? 'Add to board (open a zones scene first)' : onBoard ? `Already on ${boardScene.name}` : `Add token to ${boardScene.name}`}
            </Button>
            <Button variant="secondary" onClick={() => void duplicate()}>Duplicate</Button>
            <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => void remove()}>Delete NPC…</Button>
          </div>
        </BottomSheet>
      )}
    </li>
  )
}

function Rename({ npc, onSave, onClose }: { npc: CharacterRow; onSave: (n: string) => void; onClose: () => void }) {
  const [name, setName] = useState(npc.name)
  const save = () => {
    if (name.trim() && name.trim() !== npc.name) onSave(name.trim().slice(0, 80))
    onClose()
  }
  return (
    <BottomSheet open title="NPC name" onDismiss={save}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="NPC name" data-autofocus
          className="min-h-12 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-lg" />
        <Button type="submit">Done</Button>
      </form>
    </BottomSheet>
  )
}
