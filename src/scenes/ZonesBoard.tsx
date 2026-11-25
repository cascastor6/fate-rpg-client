import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { SceneAspectRow } from '../session/types.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { colorOf } from '../ui/colors.ts'
import { IconMinus, IconPlus } from '../ui/icons.tsx'
import { overlays } from '../ui/overlays.ts'
import {
  BOARD_H, BOARD_W, clampToken, clampZone, clampZoom, fitZoom, initials, TOKEN_SIZE, toBoard, ZOOM_MAX, ZOOM_MIN,
} from './boardMath.ts'
import type { SceneContents, TokenRow, ZoneRow } from './store.ts'

export type BoardActions = {
  moveZone: (id: string, patch: Pick<ZoneRow, 'x' | 'y'>) => void
  resizeZone: (id: string, patch: Pick<ZoneRow, 'w' | 'h'>) => void
  raiseZone: (id: string) => void
  zoneMenu: (zone: ZoneRow) => void
  addAspect: (zoneId: string | null) => void
  moveAspect: (id: string, zoneId: string | null) => void
  /** an aspect chip dropped on the open table (outside any zone) is deleted */
  deleteAspect: (a: SceneAspectRow) => void
  invokes: (a: SceneAspectRow, value: number) => void
  moveToken: (id: string, patch: Pick<TokenRow, 'x' | 'y'>) => void
  tokenMenu: (t: TokenRow) => void
  /** star on an aspect; undefined when the scene isn't the active one */
  spot?: { isLit: (id: string) => boolean; toggle: (id: string) => void }
}

/** The zones board (SPEC §8.3.3). `actions` undefined = read-only (players). */
export function ZonesBoard({
  contents,
  actions,
  viewportRef,
}: {
  contents: SceneContents
  actions?: BoardActions
  /** lets the parent place new things at the centre of the view */
  viewportRef?: (el: HTMLDivElement | null, zoom: number) => void
}) {
  const view = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [active, setActive] = useState<string | null>(null)
  const [resizing, setResizing] = useState<{ id: string; w: number; h: number } | null>(null)

  useEffect(() => viewportRef?.(view.current, zoom), [viewportRef, zoom])

  /** Zoom keeping the board point under (fx, fy) — viewport coordinates — still. */
  const zoomTo = useCallback((next: number, fx?: number, fy?: number) => {
    const el = view.current
    if (!el) return
    const z0 = zoomRef.current
    const z1 = clampZoom(next)
    if (z1 === z0) return
    const ox = fx ?? el.clientWidth / 2
    const oy = fy ?? el.clientHeight / 2
    const bx = (el.scrollLeft + ox) / z0
    const by = (el.scrollTop + oy) / z0
    setZoom(z1)
    requestAnimationFrame(() => {
      el.scrollLeft = bx * z1 - ox
      el.scrollTop = by * z1 - oy
    })
  }, [])

  const fit = useCallback(() => {
    const el = view.current
    if (el) {
      setZoom(fitZoom(el.clientWidth, el.clientHeight))
      el.scrollTo({ left: 0, top: 0 })
    }
  }, [])
  useEffect(() => {
    const el = view.current
    if (el) setZoom(fitZoom(el.clientWidth, BOARD_H)) // fit the width to start
  }, [])

  // Ctrl/⌘ + wheel zooms (needs a non-passive listener to stop page zoom).
  useEffect(() => {
    const el = view.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  // Two-finger pinch zoom (pointer events, no library). One finger scrolls natively.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const dist = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const pinchHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 2) pinch.current = { d: dist(), z: zoomRef.current }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch.current && pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        const r = view.current!.getBoundingClientRect()
        zoomTo(pinch.current.z * (dist() / pinch.current.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top)
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) pinch.current = null
    },
  }
  const pinchEnd = pinchHandlers.onPointerUp

  // Arrow keys move the focused item 10 board units (50 with Shift).
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
    const step = (event.shiftKey ? 50 : 10) * zoomRef.current
    switch (event.code) {
      case 'ArrowRight': return { ...currentCoordinates, x: currentCoordinates.x + step }
      case 'ArrowLeft': return { ...currentCoordinates, x: currentCoordinates.x - step }
      case 'ArrowDown': return { ...currentCoordinates, y: currentCoordinates.y + step }
      case 'ArrowUp': return { ...currentCoordinates, y: currentCoordinates.y - step }
    }
    return undefined
  }
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  )

  // Aspect chips land in the top-most zone under the pointer, or the tray.
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args)
    const list = hits.length ? hits : rectIntersection(args)
    return [...list].sort((a, b) => {
      const za = (args.droppableContainers.find((d) => d.id === a.id)?.data.current?.z as number | undefined) ?? 1e9
      const zb = (args.droppableContainers.find((d) => d.id === b.id)?.data.current?.z as number | undefined) ?? 1e9
      return zb - za
    })
  }

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const id = String(a.id)
    setActive(id)
    overlays.setBusy(true)
    if (id.startsWith('zone:')) actions?.raiseZone(id.slice(5))
  }
  const onDragEnd = ({ active: a, delta, over }: DragEndEvent) => {
    setActive(null)
    overlays.setBusy(false)
    if (!actions) return
    const id = String(a.id)
    const dx = toBoard(delta.x, zoomRef.current)
    const dy = toBoard(delta.y, zoomRef.current)
    if (id.startsWith('zone:')) {
      const z = contents.zones.find((x) => x.id === id.slice(5))
      if (z && (dx || dy)) {
        const c = clampZone({ ...z, x: z.x + dx, y: z.y + dy })
        actions.moveZone(z.id, { x: c.x, y: c.y })
      }
    } else if (id.startsWith('token:')) {
      const t = contents.tokens.find((x) => x.id === id.slice(6))
      if (t && (dx || dy)) actions.moveToken(t.id, clampToken({ x: t.x + dx, y: t.y + dy }))
    } else if (id.startsWith('aspect:')) {
      const asp = contents.aspects.find((x) => x.id === id.slice(7))
      const target = over ? String(over.id) : null
      if (!asp || !target) return
      if (target === 'board') return actions.deleteAspect(asp)
      const zoneId = target === 'tray' ? null : target.startsWith('zonedrop:') ? target.slice(9) : undefined
      if (zoneId !== undefined && zoneId !== asp.zone_id) actions.moveAspect(asp.id, zoneId)
    }
  }

  const unzoned = contents.aspects.filter((a) => !a.zone_id || !contents.zones.some((z) => z.id === a.zone_id))
  const activeAspect = active?.startsWith('aspect:') ? contents.aspects.find((a) => a.id === active.slice(7)) : undefined
  const scale = (n: number) => `${n * zoom}px`

  const board = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)] disabled:opacity-30"
          onClick={() => zoomTo(zoom / 1.25)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out"><IconMinus /></button>
        <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)] disabled:opacity-30"
          onClick={() => zoomTo(zoom * 1.25)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in"><IconPlus /></button>
        <button type="button" className="min-h-11 rounded-xl border border-[color:var(--border)] px-3 text-sm font-semibold" onClick={fit}>Fit</button>
      </div>
      <Tray aspects={unzoned} actions={actions} activeId={active} />
      <div
        ref={view}
        {...pinchHandlers}
        onPointerCancel={pinchEnd}
        onPointerLeave={pinchEnd}
        className="relative h-[60dvh] min-h-80 overflow-auto rounded-2xl border border-[color:var(--border)] bg-stone-300 dark:bg-stone-900 lg:h-[calc(100dvh-22rem)]"
        style={{ touchAction: 'pan-x pan-y' }}
        aria-label="Zones board"
        role="region"
      >
        <div style={{ width: scale(BOARD_W), height: scale(BOARD_H), position: 'relative' }}>
          <Felt zoom={zoom} enabled={!!actions} draggingAspect={!!active?.startsWith('aspect:')}>
            {contents.zones.map((z) => (
              <Zone
                key={z.id}
                zone={resizing?.id === z.id ? { ...z, w: resizing.w, h: resizing.h } : z}
                aspects={contents.aspects.filter((a) => a.zone_id === z.id)}
                actions={actions}
                zoom={zoom}
                activeId={active}
                onResize={(w, h, done) => {
                  if (done) {
                    setResizing(null)
                    const c = clampZone({ ...z, w, h })
                    actions?.resizeZone(z.id, { w: c.w, h: c.h })
                  } else setResizing({ id: z.id, w, h })
                }}
              />
            ))}
            {contents.tokens.map((t) => <Token key={t.id} token={t} actions={actions} zoom={zoom} />)}
            {contents.zones.length === 0 && contents.tokens.length === 0 && (
              <p className="absolute inset-0 flex items-center justify-center text-2xl text-white/60">
                {actions ? 'Add a zone to start laying out the scene.' : 'The GM hasn’t laid out this scene yet.'}
              </p>
            )}
          </Felt>
        </div>
      </div>
    </div>
  )

  if (!actions) return board
  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragCancel={() => { setActive(null); overlays.setBusy(false) }} autoScroll={{ threshold: { x: 0.1, y: 0.1 } }}>
      {board}
      <DragOverlay>
        {activeAspect ? <ChipBody aspect={activeAspect} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * The table felt. While an aspect chip is dragged it becomes a drop target that deletes
 * the aspect (it sits below zones and the tray, which win when the chip is over them).
 */
function Felt({ zoom, enabled, draggingAspect, children }: { zoom: number; enabled: boolean; draggingAspect: boolean; children: ReactNode }) {
  const drop = useDroppable({ id: 'board', disabled: !enabled, data: { z: -1 } })
  const deleting = draggingAspect && drop.isOver
  return (
    <div
      ref={drop.setNodeRef}
      className="absolute left-0 top-0 rounded-xl"
      style={{
        width: BOARD_W, height: BOARD_H, transform: `scale(${zoom})`, transformOrigin: '0 0',
        backgroundImage: 'radial-gradient(circle at 30% 20%, #2f5d46, #1f3f30), repeating-linear-gradient(45deg, rgba(255,255,255,.02) 0 2px, transparent 2px 6px)',
        boxShadow: deleting ? 'inset 0 0 0 12px rgba(220,38,38,.85)' : undefined,
      }}
    >
      {children}
      {draggingAspect && (
        <p
          className={`pointer-events-none absolute inset-x-0 top-4 z-[20000] mx-auto w-fit rounded-full px-5 py-2 text-xl font-bold shadow-lg ${deleting ? 'bg-red-600 text-white' : 'bg-black/60 text-white'}`}
          aria-live="polite"
        >
          {deleting ? 'Release to delete this aspect' : 'Drop on the open table to delete · on a zone or Scene-wide to move'}
        </p>
      )}
    </div>
  )
}

/** Translate by a screen-space dnd transform inside the scaled board. */
const moved = (t: { x: number; y: number } | null, zoom: number): CSSProperties | undefined =>
  t ? { transform: `translate(${t.x / zoom}px, ${t.y / zoom}px)` } : undefined

function Zone({
  zone, aspects, actions, zoom, activeId, onResize,
}: {
  zone: ZoneRow
  aspects: SceneAspectRow[]
  actions?: BoardActions
  zoom: number
  activeId: string | null
  onResize: (w: number, h: number, done: boolean) => void
}) {
  const drag = useDraggable({ id: `zone:${zone.id}`, disabled: !actions })
  const drop = useDroppable({ id: `zonedrop:${zone.id}`, disabled: !actions, data: { z: zone.z } })
  const c = zone.color ? colorOf(zone.color) : null
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const highlighted = drop.isOver && activeId?.startsWith('aspect:')

  return (
    <section
      ref={(el) => { drag.setNodeRef(el); drop.setNodeRef(el) }}
      aria-label={`Zone ${zone.title}`}
      className={`absolute flex flex-col overflow-hidden rounded-xl bg-[#fffdf7] text-stone-900 shadow-lg ${highlighted ? 'ring-4 ring-amber-400' : ''} ${drag.isDragging ? 'opacity-90 shadow-2xl' : ''}`}
      style={{ left: zone.x, top: zone.y, width: zone.w, height: zone.h, zIndex: drag.isDragging ? 9999 : zone.z, ...moved(drag.transform, zoom) }}
    >
      <header
        className="flex min-h-16 items-center gap-1 px-4"
        style={{ background: c?.fill ?? '#e7e5e4', color: c?.ink ?? '#1c1917' }}
      >
        <span
          {...(actions ? drag.listeners : {})}
          {...(actions ? drag.attributes : {})}
          aria-label={actions ? `Move zone ${zone.title}` : undefined}
          className={`flex-1 truncate py-2 text-3xl font-bold ${actions ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
        >
          {zone.title}
        </span>
        {actions && (
          <button type="button" onClick={() => actions.zoneMenu(zone)} aria-label={`Zone ${zone.title} options`}
            className="flex size-14 items-center justify-center rounded-lg text-3xl font-bold hover:bg-black/10">⋯</button>
        )}
      </header>
      <ul className="flex flex-1 flex-wrap content-start gap-3 overflow-auto p-3">
        {aspects.map((a) => <li key={a.id}><Chip aspect={a} actions={actions} activeId={activeId} /></li>)}
        {actions && (
          <li>
            <button type="button" onClick={() => actions.addAspect(zone.id)}
              className="min-h-14 rounded-lg border-2 border-dashed border-stone-300 px-4 text-xl font-semibold text-stone-500 hover:border-stone-500">
              + Aspect
            </button>
          </li>
        )}
      </ul>
      {actions && (
        <span
          role="separator"
          aria-label={`Resize zone ${zone.title}`}
          className="absolute bottom-0 right-0 size-10 cursor-nwse-resize touch-none"
          style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,.35) 50%)' }}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            start.current = { x: e.clientX, y: e.clientY, w: zone.w, h: zone.h }
          }}
          onPointerMove={(e) => {
            if (!start.current) return
            onResize(start.current.w + toBoard(e.clientX - start.current.x, zoom), start.current.h + toBoard(e.clientY - start.current.y, zoom), false)
          }}
          onPointerUp={(e) => {
            if (!start.current) return
            const s = start.current
            start.current = null
            onResize(s.w + toBoard(e.clientX - s.x, zoom), s.h + toBoard(e.clientY - s.y, zoom), true)
          }}
        />
      )}
    </section>
  )
}

function ChipBody({ aspect, children }: { aspect: SceneAspectRow; children?: ReactNode }) {
  return (
    <span className="inline-flex min-h-10 max-w-80 items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1 text-xl font-semibold text-stone-900 shadow-sm">
      <span className="truncate">{aspect.text}</span>
      {children}
    </span>
  )
}

function Chip({ aspect, actions, activeId }: { aspect: SceneAspectRow; actions?: BoardActions; activeId: string | null }) {
  const drag = useDraggable({ id: `aspect:${aspect.id}`, disabled: !actions })
  const lit = actions?.spot?.isLit(aspect.id)
  return (
    <span
      ref={drag.setNodeRef}
      {...(actions ? drag.listeners : {})}
      {...(actions ? drag.attributes : {})}
      aria-label={actions ? `Move aspect ${aspect.text}` : undefined}
      role={actions ? 'button' : undefined}
      className={`inline-block ${actions ? 'cursor-grab touch-none' : ''} ${activeId === `aspect:${aspect.id}` ? 'opacity-30' : ''}`}
      style={lit ? { outline: '3px solid #d97706', borderRadius: 10 } : undefined}
    >
      <ChipBody aspect={aspect}>
        {actions ? (
          <span className="flex items-center" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <button type="button" className="flex size-10 items-center justify-center rounded disabled:opacity-30" disabled={aspect.free_invokes <= 0}
              onClick={() => actions.invokes(aspect, aspect.free_invokes - 1)} aria-label={`Remove a free invoke from ${aspect.text}`}>−</button>
            <span className="min-w-4 text-center tabular-nums" title="Free invokes">{aspect.free_invokes}</span>
            <button type="button" className="flex size-10 items-center justify-center rounded"
              onClick={() => actions.invokes(aspect, aspect.free_invokes + 1)} aria-label={`Add a free invoke to ${aspect.text}`}>+</button>
            {actions.spot && (
              <button type="button" className={`flex size-10 items-center justify-center rounded text-xl ${lit ? 'text-amber-600' : 'text-stone-400'}`}
                onClick={() => actions.spot!.toggle(aspect.id)} aria-pressed={!!lit}
                aria-label={`${lit ? 'Clear highlight on' : 'Highlight for everyone:'} ${aspect.text}`}>★</button>
            )}
            <button type="button" className="flex size-10 items-center justify-center rounded text-2xl leading-none text-stone-400 hover:bg-red-50 hover:text-red-700"
              onClick={() => actions.deleteAspect(aspect)} aria-label={`Delete aspect ${aspect.text}`} title="Delete">×</button>
          </span>
        ) : aspect.free_invokes > 0 && (
          <span className="rounded bg-amber-100 px-1 text-xs tabular-nums" title="Free invokes">{aspect.free_invokes}</span>
        )}
      </ChipBody>
    </span>
  )
}

function Tray({ aspects, actions, activeId }: { aspects: SceneAspectRow[]; actions?: BoardActions; activeId: string | null }) {
  const drop = useDroppable({ id: 'tray', disabled: !actions })
  if (!actions && aspects.length === 0) return null
  return (
    <section
      ref={drop.setNodeRef}
      aria-label="Scene-wide aspects"
      className={`flex flex-wrap items-center gap-2 rounded-2xl border-2 border-dashed p-2 ${drop.isOver && activeId?.startsWith('aspect:') ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40' : 'border-[color:var(--border)]'}`}
    >
      <span className="px-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">Scene-wide</span>
      {aspects.map((a) => <Chip key={a.id} aspect={a} actions={actions} activeId={activeId} />)}
      {actions && (
        <button type="button" onClick={() => actions.addAspect(null)}
          className="min-h-10 rounded-lg border-2 border-dashed border-[color:var(--border)] px-3 text-sm font-semibold text-[color:var(--muted)]">
          + Aspect
        </button>
      )}
      {actions && aspects.length === 0 && <span className="text-sm text-[color:var(--muted)]">Drop aspects here to take them out of a zone.</span>}
    </section>
  )
}

function Token({ token, actions, zoom }: { token: TokenRow; actions?: BoardActions; zoom: number }) {
  const { members, characters } = useSession()
  const drag = useDraggable({ id: `token:${token.id}`, disabled: !actions })
  const ch = characters.find((c) => c.id === token.character_id)
  const isPc = ch?.kind === 'pc'
  const color = colorOf(isPc ? members.find((m) => m.user_id === ch?.owner_id)?.color : token.color ?? 'slate')
  const half = TOKEN_SIZE / 2
  return (
    <div
      ref={drag.setNodeRef}
      className="absolute flex flex-col items-center"
      style={{ left: token.x - half, top: token.y - half, width: TOKEN_SIZE, zIndex: drag.isDragging ? 10001 : 10000, ...moved(drag.transform, zoom) }}
    >
      {actions ? (
        <button
          type="button"
          {...drag.listeners}
          {...drag.attributes}
          onClick={() => actions.tokenMenu(token)}
          title={token.label}
          aria-label={`Token ${token.label}: drag to move, click for options`}
          className="relative flex cursor-grab touch-none items-center justify-center rounded-full border-4 border-white text-xl font-black shadow-lg active:cursor-grabbing"
          style={{ width: TOKEN_SIZE, height: TOKEN_SIZE, background: color.fill, color: color.ink }}
        >
          {initials(token.label)}
          {!isPc && <span className="absolute -right-1 -top-1 size-4 rounded-sm border-2 border-white bg-stone-900" aria-hidden="true" />}
        </button>
      ) : (
        <span
          role="img"
          title={token.label}
          aria-label={`Token ${token.label}`}
          className="relative flex items-center justify-center rounded-full border-4 border-white text-xl font-black shadow-lg"
          style={{ width: TOKEN_SIZE, height: TOKEN_SIZE, background: color.fill, color: color.ink }}
        >
          {initials(token.label)}
          {!isPc && <span className="absolute -right-1 -top-1 size-4 rounded-sm border-2 border-white bg-stone-900" aria-hidden="true" />}
        </span>
      )}
      <span className="mt-1 max-w-40 truncate rounded bg-black/60 px-1.5 text-base font-semibold text-white">{token.label}</span>
    </div>
  )
}
