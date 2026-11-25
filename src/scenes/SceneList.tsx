import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, type FormEvent } from 'react'
import { positionBetween } from '../lib/positions.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { Button, TextField } from '../ui/primitives.tsx'
import { useScenes, type SceneKind, type SceneRow } from './store.ts'

/** Scene list (SPEC §8.3.1): pick, reorder, create. The live scene is marked. */
export function SceneList({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const { session } = useSession()
  const { store, scenes } = useScenes(session.id)
  const [creating, setCreating] = useState(false)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = scenes.findIndex((s) => s.id === active.id)
    const to = scenes.findIndex((s) => s.id === over.id)
    const order = arrayMove(scenes, from, to)
    const i = order.findIndex((s) => s.id === active.id)
    void store.patchScene(String(active.id), { position: positionBetween(order[i - 1]?.position, order[i + 1]?.position) })
  }
  return (
    <nav aria-label="Scenes" className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">Scenes</h2>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1">
            {scenes.map((s) => <Item key={s.id} scene={s} live={session.active_scene_id === s.id} selected={selected === s.id} onSelect={() => onSelect(s.id)} />)}
          </ul>
        </SortableContext>
      </DndContext>
      <Button variant="secondary" onClick={() => setCreating(true)}>+ New scene</Button>
      {creating && <NewScene onClose={() => setCreating(false)} onCreated={onSelect} />}
    </nav>
  )
}

function Item({ scene, live, selected, onSelect }: { scene: SceneRow; live: boolean; selected: boolean; onSelect: () => void }) {
  const s = useSortable({ id: scene.id })
  return (
    <li ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      className={`flex items-stretch rounded-xl border ${selected ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/40' : 'border-transparent'} ${s.isDragging ? 'opacity-50' : ''}`}>
      <button type="button" {...s.attributes} {...s.listeners} aria-label={`Drag ${scene.name}`}
        className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center text-[color:var(--muted)]">⠿</button>
      <button type="button" onClick={onSelect} aria-current={selected} className="flex min-h-12 flex-1 items-center gap-2 pr-3 text-left">
        <span className="flex-1 truncate font-medium">{scene.name}</span>
        <span className="text-xs text-[color:var(--muted)]">{scene.kind === 'zones' ? 'Zones' : 'Narrative'}</span>
        {live && <span className="rounded-full bg-green-600 px-2 text-xs font-bold text-white">● Live</span>}
      </button>
    </li>
  )
}

function NewScene({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { session } = useSession()
  const { store } = useScenes(session.id)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SceneKind>('narrative')
  const create = async (e: FormEvent) => {
    e.preventDefault()
    const id = await store.createScene(name.trim().slice(0, 80) || 'New scene', kind)
    onClose()
    if (id) onCreated(id)
  }
  return (
    <BottomSheet open title="New scene" onDismiss={onClose}>
      <form className="flex flex-col gap-4" onSubmit={create}>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="The Docks" />
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Scene type">
          {([['narrative', 'Narrative', 'A list of scene aspects'], ['zones', 'Zones', 'Index cards and tokens on a table']] as const).map(([k, n, d]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`flex min-h-16 flex-col items-start justify-center rounded-xl border-2 px-3 text-left ${kind === k ? 'border-amber-600' : 'border-[color:var(--border)]'}`}>
              <span className="font-semibold">{n}</span><span className="text-sm text-[color:var(--muted)]">{d}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">Create</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </BottomSheet>
  )
}
