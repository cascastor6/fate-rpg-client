import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, type FormEvent } from 'react'
import { positionBetween } from '../lib/positions.ts'
import type { SceneAspectRow } from '../session/types.ts'
import { IconMinus, IconPlus, IconX } from '../ui/icons.tsx'
import { Button } from '../ui/primitives.tsx'
import type { SceneContents, ScenesStore } from './store.ts'

type Spot = { isLit: (id: string) => boolean; toggle: (id: string) => void }

/**
 * Narrative scene (SPEC §8.3.2): a list of scene aspects with free invokes. GM: add, edit
 * inline, delete, drag to reorder, star to spotlight. Players: read-only.
 */
export function NarrativeScene({
  sceneId, contents, store, spot,
}: {
  sceneId: string
  contents: SceneContents
  /** undefined = read-only */
  store?: ScenesStore
  spot?: Spot
}) {
  const [text, setText] = useState('')
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Aspects that sit in zones (if this scene was a zones scene) are grouped under the zone title.
  const groups = [
    { title: null as string | null, items: contents.aspects.filter((a) => !a.zone_id || !contents.zones.some((z) => z.id === a.zone_id)) },
    ...contents.zones.map((z) => ({ title: z.title, items: contents.aspects.filter((a) => a.zone_id === z.id) })).filter((g) => g.items.length),
  ]

  const onDragEnd = (items: SceneAspectRow[]) => ({ active, over }: DragEndEvent) => {
    if (!store || !over || active.id === over.id) return
    const from = items.findIndex((a) => a.id === active.id)
    const to = items.findIndex((a) => a.id === over.id)
    if (from < 0 || to < 0) return
    const order = arrayMove(items, from, to)
    const i = order.findIndex((a) => a.id === active.id)
    void store.patchAspect(sceneId, String(active.id), { position: positionBetween(order[i - 1]?.position, order[i + 1]?.position) })
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || !store) return
    setText('')
    void store.addAspect(sceneId, t)
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.title ?? '_'} aria-label={g.title ?? 'Scene aspects'}>
          {g.title && <h3 className="mb-1 px-1 text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">{g.title}</h3>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(g.items)}>
            <SortableContext items={g.items.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2">
                {g.items.map((a) => <Row key={a.id} aspect={a} sceneId={sceneId} store={store} spot={spot} />)}
              </ul>
            </SortableContext>
          </DndContext>
          {!g.title && g.items.length === 0 && (
            <p className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-center text-[color:var(--muted)]">
              {store ? 'No aspects yet. Add the first one below.' : 'No scene aspects yet.'}
            </p>
          )}
        </section>
      ))}
      {store && (
        <form className="flex gap-2" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="New scene aspect, e.g. Smoky Tavern"
            aria-label="New scene aspect" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3" />
          <Button type="submit" disabled={!text.trim()}>Add</Button>
        </form>
      )}
    </div>
  )
}

function Row({ aspect, sceneId, store, spot }: { aspect: SceneAspectRow; sceneId: string; store?: ScenesStore; spot?: Spot }) {
  const sortable = useSortable({ id: aspect.id, disabled: !store })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(aspect.text)
  const lit = spot?.isLit(aspect.id)
  const save = () => {
    setEditing(false)
    const t = draft.trim()
    if (store && t && t !== aspect.text) void store.patchAspect(sceneId, aspect.id, { text: t.slice(0, 200) })
    else setDraft(aspect.text)
  }
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition, ...(lit ? { outline: '3px solid #d97706' } : {}) }}
      className={`flex min-h-14 items-center gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] pr-1 ${sortable.isDragging ? 'opacity-50' : ''}`}
    >
      {store && (
        <button type="button" {...sortable.attributes} {...sortable.listeners} aria-label={`Drag ${aspect.text}`}
          className="flex h-12 w-9 shrink-0 cursor-grab touch-none items-center justify-center text-[color:var(--muted)]">⠿</button>
      )}
      {editing ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(aspect.text); setEditing(false) } }}
          maxLength={200} aria-label="Aspect text" className="min-h-11 min-w-0 flex-1 rounded-lg border border-amber-600 bg-[color:var(--bg)] px-2 text-lg font-semibold" />
      ) : store ? (
        <button type="button" onClick={() => setEditing(true)} className="min-h-12 min-w-0 flex-1 px-2 text-left text-lg font-semibold" aria-label={`Edit ${aspect.text}`}>
          {aspect.text}
        </button>
      ) : (
        <span className="min-w-0 flex-1 px-4 py-2 text-lg font-semibold">{aspect.text}</span>
      )}
      <span className="flex items-center" role="group" aria-label={`Free invokes on ${aspect.text}`}>
        {store && (
          <button type="button" className="flex size-10 items-center justify-center rounded-full disabled:opacity-30" disabled={aspect.free_invokes <= 0}
            onClick={() => void store.patchAspect(sceneId, aspect.id, { free_invokes: aspect.free_invokes - 1 })} aria-label="Remove a free invoke">
            <IconMinus className="size-4" />
          </button>
        )}
        {(store || aspect.free_invokes > 0) && (
          <span className="min-w-6 text-center font-bold tabular-nums" title="Free invokes">{aspect.free_invokes}{!store && ' free'}</span>
        )}
        {store && (
          <button type="button" className="flex size-10 items-center justify-center rounded-full disabled:opacity-30" disabled={aspect.free_invokes >= 99}
            onClick={() => void store.patchAspect(sceneId, aspect.id, { free_invokes: aspect.free_invokes + 1 })} aria-label="Add a free invoke">
            <IconPlus className="size-4" />
          </button>
        )}
      </span>
      {spot && (
        <button type="button" onClick={() => spot.toggle(aspect.id)} aria-pressed={!!lit}
          aria-label={`${lit ? 'Clear highlight on' : 'Highlight for everyone:'} ${aspect.text}`}
          className={`flex size-10 items-center justify-center rounded-lg text-xl ${lit ? 'text-amber-600' : 'text-[color:var(--muted)] opacity-60 hover:opacity-100'}`}>★</button>
      )}
      {store && (
        <button type="button" onClick={() => void store.deleteAspect(sceneId, aspect.id)} aria-label={`Delete ${aspect.text}`}
          className="flex size-10 items-center justify-center rounded-lg text-[color:var(--muted)] hover:bg-black/5 dark:hover:bg-white/10">
          <IconX className="size-4" />
        </button>
      )}
    </li>
  )
}
