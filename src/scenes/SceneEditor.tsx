import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDice } from '../dice/useDice.ts'
import { useSpotlight } from '../gm/spotlight.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { ColorPicker } from '../ui/ColorPicker.tsx'
import { isPlayerColor, type PlayerColor } from '../ui/colors.ts'
import { Button, Notice, Spinner, TextField } from '../ui/primitives.tsx'
import { clampToken, viewCenter, ZONE_DEFAULT } from './boardMath.ts'
import { NarrativeScene } from './NarrativeScene.tsx'
import { useScenes, type SceneRow, type TokenRow, type ZoneRow } from './store.ts'
import { ZonesBoard, type BoardActions } from './ZonesBoard.tsx'

/** GM editor for one scene (SPEC §8.3): header controls + narrative list or zones board. */
export function SceneEditor({ scene, onDeleted }: { scene: SceneRow; onDeleted: () => void }) {
  const { session } = useSession()
  const { store, contents } = useScenes(session.id)
  const spotlight = useSpotlight()
  const c = contents[scene.id]
  const isLive = session.active_scene_id === scene.id
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [zoneMenu, setZoneMenu] = useState<ZoneRow | null>(null)
  const [tokenMenu, setTokenMenu] = useState<TokenRow | null>(null)
  const [picker, setPicker] = useState(false)
  const [newAspect, setNewAspect] = useState<{ zoneId: string | null } | null>(null)
  const viewport = useRef<{ el: HTMLDivElement | null; zoom: number }>({ el: null, zoom: 1 })

  useEffect(() => void store.loadScene(scene.id), [store, scene.id])

  const center = () => {
    const { el, zoom } = viewport.current
    return el ? viewCenter(el.scrollLeft, el.scrollTop, el.clientWidth, el.clientHeight, zoom) : { x: 800, y: 500 }
  }
  const spot = isLive ? { isLit: spotlight.isSceneAspectLit, toggle: (id: string) => void spotlight.toggleSceneAspect(id) } : undefined

  const actions: BoardActions = {
    moveZone: (id, p) => void store.patchZone(scene.id, id, p),
    resizeZone: (id, p) => void store.patchZone(scene.id, id, p),
    raiseZone: (id) => void store.bringToFront(scene.id, id),
    zoneMenu: setZoneMenu,
    addAspect: (zoneId) => setNewAspect({ zoneId }),
    moveAspect: (id, zoneId) => void store.patchAspect(scene.id, id, { zone_id: zoneId }),
    invokes: (a, v) => void store.patchAspect(scene.id, a.id, { free_invokes: Math.max(0, Math.min(99, v)) }),
    moveToken: (id, p) => void store.patchToken(scene.id, id, p),
    tokenMenu: setTokenMenu,
    spot,
  }
  const setViewport = useCallback((el: HTMLDivElement | null, zoom: number) => { viewport.current = { el, zoom } }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRenaming(true)} className="min-h-11 text-left text-xl font-bold hover:underline">{scene.name}</button>
        {isLive && <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-bold text-white">● Live</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex rounded-xl border border-[color:var(--border)] p-1" role="radiogroup" aria-label="Scene type">
            {(['narrative', 'zones'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={scene.kind === k} onClick={() => void store.patchScene(scene.id, { kind: k })}
                className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${scene.kind === k ? 'bg-amber-700 text-white' : ''}`}>
                {k === 'narrative' ? 'Narrative' : 'Zones'}
              </button>
            ))}
          </div>
          {isLive ? (
            <Button variant="secondary" onClick={() => void store.setActive(null)}>Hide from players</Button>
          ) : (
            <Button onClick={() => void store.setActive(scene.id)}>Show to players</Button>
          )}
        </div>
      </div>

      {!isLive && <p className="text-sm text-[color:var(--muted)]">Prep: players can’t see this scene. Highlighting works once it’s live.</p>}

      {!c ? (
        <div className="flex justify-center py-10"><Spinner className="size-6" /></div>
      ) : scene.kind === 'narrative' ? (
        <NarrativeScene sceneId={scene.id} contents={c} store={store} spot={spot} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => {
              const p = center()
              void store.addZone(scene.id, { title: 'Zone', x: p.x - ZONE_DEFAULT.w / 2, y: p.y - ZONE_DEFAULT.h / 2, ...ZONE_DEFAULT })
            }}>+ Zone</Button>
            <Button variant="secondary" onClick={() => setPicker(true)}>+ Tokens</Button>
          </div>
          <ZonesBoard contents={c} actions={actions} viewportRef={setViewport} />
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-3">
        <Button variant="ghost" onClick={async () => { await store.duplicateScene(scene.id) }}>Duplicate scene</Button>
        {!confirmDelete ? (
          <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => setConfirmDelete(true)}>Delete scene…</Button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Delete “{scene.name}” and everything on it?</span>
            <Button variant="danger" onClick={async () => { await store.deleteScene(scene.id); onDeleted() }}>Delete</Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep</Button>
          </span>
        )}
      </div>

      {renaming && <NameSheet title="Scene name" initial={scene.name} max={80} onClose={() => setRenaming(false)}
        onSave={(name) => void store.patchScene(scene.id, { name })} />}
      {newAspect && <NameSheet title="New aspect" initial="" max={200} placeholder="Slippery Planks" onClose={() => setNewAspect(null)}
        onSave={(text) => void store.addAspect(scene.id, text, newAspect.zoneId)} />}
      {zoneMenu && <ZoneSheet zone={zoneMenu} onClose={() => setZoneMenu(null)}
        onSave={(p) => void store.patchZone(scene.id, zoneMenu.id, p)} onDelete={() => void store.deleteZone(scene.id, zoneMenu.id)} />}
      {picker && c && <TokenPicker sceneId={scene.id} placed={c.tokens} origin={center()} onClose={() => setPicker(false)} />}
      {tokenMenu && <TokenSheet sceneId={scene.id} token={tokenMenu} onClose={() => setTokenMenu(null)} />}
    </div>
  )
}

function NameSheet({ title, initial, max, placeholder, onSave, onClose }: {
  title: string; initial: string; max: number; placeholder?: string; onSave: (v: string) => void; onClose: () => void
}) {
  const [v, setV] = useState(initial)
  const save = (e?: FormEvent) => {
    e?.preventDefault()
    const t = v.trim()
    if (t && t !== initial) onSave(t.slice(0, max))
    onClose()
  }
  return (
    <BottomSheet open title={title} onDismiss={() => save()}>
      <form className="flex flex-col gap-3" onSubmit={save}>
        <input value={v} onChange={(e) => setV(e.target.value)} maxLength={max} placeholder={placeholder} aria-label={title} data-autofocus
          className="min-h-12 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-lg" />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={!v.trim()}>Done</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </BottomSheet>
  )
}

function ZoneSheet({ zone, onSave, onDelete, onClose }: {
  zone: ZoneRow; onSave: (p: Partial<Pick<ZoneRow, 'title' | 'color'>>) => void; onDelete: () => void; onClose: () => void
}) {
  const [title, setTitle] = useState(zone.title)
  const [color, setColor] = useState<string | null>(zone.color)
  const save = () => {
    const p: Partial<Pick<ZoneRow, 'title' | 'color'>> = {}
    if (title.trim() && title.trim() !== zone.title) p.title = title.trim().slice(0, 60)
    if (color !== zone.color) p.color = color
    if (Object.keys(p).length) onSave(p)
    onClose()
  }
  return (
    <BottomSheet open title="Zone" onDismiss={save}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} data-autofocus />
        <ColorPicker label="Colour" value={(isPlayerColor(color) ? color : 'slate') as PlayerColor} onChange={setColor} />
        <Button variant="ghost" onClick={() => setColor(null)} disabled={color === null}>No colour</Button>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">Done</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
        <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => { onDelete(); onClose() }}>
          Delete zone (its aspects move to scene-wide)
        </Button>
      </form>
    </BottomSheet>
  )
}

/** Add PC / NPC / free tokens; one per character per scene (SPEC §8.3.3). */
function TokenPicker({ sceneId, placed, origin, onClose }: { sceneId: string; placed: TokenRow[]; origin: { x: number; y: number }; onClose: () => void }) {
  const { session, characters } = useSession()
  const { store } = useScenes(session.id)
  const [free, setFree] = useState('')
  const has = (id: string) => placed.some((t) => t.character_id === id)
  const pcs = characters.filter((c) => c.kind === 'pc')
  const npcs = characters.filter((c) => c.kind === 'npc')
  const spot = (i: number) => clampToken({ x: origin.x - 90 + (i % 5) * 45, y: origin.y + Math.floor(i / 5) * 55 })
  const add = (list: { character_id: string | null; label: string; color: string | null }[]) => {
    void store.addTokens(sceneId, list.map((t, i) => ({ ...t, ...spot(i) })))
    onClose()
  }
  const row = (c: (typeof characters)[number]) => (
    <li key={c.id}>
      <button type="button" disabled={has(c.id)} onClick={() => add([{ character_id: c.id, label: c.name.slice(0, 40), color: c.kind === 'npc' ? 'slate' : null }])}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10">
        <span className="flex-1 truncate font-medium">{c.name}</span>
        <span className="text-sm text-[color:var(--muted)]">{has(c.id) ? 'On the board' : c.kind === 'npc' ? 'NPC' : 'PC'}</span>
      </button>
    </li>
  )
  const missingPcs = pcs.filter((c) => !has(c.id))
  return (
    <BottomSheet open title="Add tokens" onDismiss={onClose}>
      <div className="flex flex-col gap-4">
        <Button disabled={!missingPcs.length} onClick={() => add(missingPcs.map((c) => ({ character_id: c.id, label: c.name.slice(0, 40), color: null })))}>
          Add all PCs{missingPcs.length ? ` (${missingPcs.length})` : ''}
        </Button>
        {pcs.length > 0 && <section><h3 className="text-sm font-semibold">Player characters</h3><ul>{pcs.map(row)}</ul></section>}
        {npcs.length > 0 && <section><h3 className="text-sm font-semibold">NPCs</h3><ul>{npcs.map(row)}</ul></section>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (free.trim()) add([{ character_id: null, label: free.trim().slice(0, 40), color: 'slate' }]) }}>
          <input value={free} onChange={(e) => setFree(e.target.value)} maxLength={40} placeholder="Free token, e.g. Car" aria-label="Free token label"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3" />
          <Button type="submit" variant="secondary" disabled={!free.trim()}>Add</Button>
        </form>
      </div>
    </BottomSheet>
  )
}

function TokenSheet({ sceneId, token, onClose }: { sceneId: string; token: TokenRow; onClose: () => void }) {
  const { session, characters } = useSession()
  const { store } = useScenes(session.id)
  const dice = useDice()
  const navigate = useNavigate()
  const ch = characters.find((c) => c.id === token.character_id)
  const [label, setLabel] = useState(token.label)
  const [color, setColor] = useState<PlayerColor>(isPlayerColor(token.color) ? token.color : 'slate')
  const save = () => {
    const p: Partial<Pick<TokenRow, 'label' | 'color'>> = {}
    if (label.trim() && label.trim() !== token.label) p.label = label.trim().slice(0, 40)
    if (ch?.kind !== 'pc' && color !== token.color) p.color = color
    if (Object.keys(p).length) void store.patchToken(sceneId, token.id, p)
    onClose()
  }
  return (
    <BottomSheet open title="Token" onDismiss={save}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <TextField label="Label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40}
          hint={ch?.kind === 'npc' && !ch.visible_to_players ? 'Players see this label even though the NPC is hidden, e.g. use “???”.' : undefined} />
        {ch?.kind === 'pc'
          ? <Notice>PC tokens always use the player’s colour.</Notice>
          : <ColorPicker label="Colour" value={color} onChange={setColor} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="flex-1">Done</Button>
          {ch && <Button variant="secondary" onClick={() => { onClose(); navigate(`/s/${session.id}/c/${ch.id}`) }}>Open sheet</Button>}
          {ch?.kind === 'npc' && <Button variant="secondary" onClick={() => { onClose(); dice.store.openDialog(ch.id) }}>Roll…</Button>}
        </div>
        <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => { void store.deleteToken(sceneId, token.id); onClose() }}>
          Remove from board
        </Button>
      </form>
    </BottomSheet>
  )
}
