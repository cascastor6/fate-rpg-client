// Scenes for one session (SPEC §8.3): the list, and the zones / aspects / tokens of
// each scene that's been opened. GM edits apply locally first, then go to the server;
// realtime keeps everyone in sync. Players only ever see the active scene (RLS).

import { useSyncExternalStore } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { byPosition, positionBetween } from '../lib/positions.ts'
import { supabase } from '../lib/supabase.ts'
import { SCENE_ASPECT_COLUMNS, type SceneAspectRow } from '../session/types.ts'
import { upsertRow } from '../sheet/remote.ts'
import { toast } from '../ui/toast.tsx'

export type SceneKind = 'narrative' | 'zones'
export type SceneRow = { id: string; session_id: string; name: string; kind: SceneKind; position: number; version: number }
export type ZoneRow = {
  id: string; scene_id: string; session_id: string; title: string; color: string | null
  x: number; y: number; w: number; h: number; z: number; version: number
}
export type TokenRow = {
  id: string; scene_id: string; session_id: string; character_id: string | null
  label: string; color: string | null; x: number; y: number; version: number
}
export type SceneContents = { zones: ZoneRow[]; aspects: SceneAspectRow[]; tokens: TokenRow[] }

const SCENE_COLUMNS = 'id,session_id,name,kind,position,version'
const ZONE_COLUMNS = 'id,scene_id,session_id,title,color,x,y,w,h,z,version'
const TOKEN_COLUMNS = 'id,scene_id,session_id,character_id,label,color,x,y,version'

export type ScenesSnapshot = { loaded: boolean; scenes: SceneRow[]; contents: Record<string, SceneContents> }

const sortAspects = (a: SceneAspectRow[]) => [...a].sort((x, y) => x.position - y.position || x.id.localeCompare(y.id))

export class ScenesStore {
  private snap: ScenesSnapshot = { loaded: false, scenes: [], contents: {} }
  private listeners = new Set<() => void>()
  private loadingScenes = new Set<string>()
  readonly sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  private set(patch: Partial<ScenesSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const l of this.listeners) l()
  }
  private setContents(sceneId: string, fn: (c: SceneContents) => SceneContents) {
    const cur = this.snap.contents[sceneId]
    if (!cur) return
    this.set({ contents: { ...this.snap.contents, [sceneId]: fn(cur) } })
  }

  /** Scene list (GM: all; players: the active one). Also refreshes any scene already open. */
  async load() {
    const { data, error } = await supabase.from('scenes').select(SCENE_COLUMNS).eq('session_id', this.sessionId).returns<SceneRow[]>()
    if (error) return
    const scenes = (data ?? []).sort(byPosition)
    const keep = new Set(scenes.map((s) => s.id))
    const contents = Object.fromEntries(Object.entries(this.snap.contents).filter(([id]) => keep.has(id)))
    this.set({ loaded: true, scenes, contents })
    for (const id of Object.keys(contents)) void this.loadScene(id, true)
  }

  async loadScene(sceneId: string, force = false) {
    if (!force && (this.snap.contents[sceneId] || this.loadingScenes.has(sceneId))) return
    this.loadingScenes.add(sceneId)
    try {
      const [z, a, t] = await Promise.all([
        supabase.from('scene_zones').select(ZONE_COLUMNS).eq('scene_id', sceneId).returns<ZoneRow[]>(),
        supabase.from('scene_aspects').select(SCENE_ASPECT_COLUMNS).eq('scene_id', sceneId).returns<SceneAspectRow[]>(),
        supabase.from('scene_tokens').select(TOKEN_COLUMNS).eq('scene_id', sceneId).returns<TokenRow[]>(),
      ])
      if (z.error || a.error || t.error) return
      this.set({ contents: { ...this.snap.contents, [sceneId]: { zones: z.data ?? [], aspects: sortAspects(a.data ?? []), tokens: t.data ?? [] } } })
    } finally {
      this.loadingScenes.delete(sceneId)
    }
  }

  /** Realtime changes for scenes and their children. */
  applyRemote(table: string, type: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) {
    if (table === 'scenes') {
      if (type !== 'DELETE' && row.session_id !== this.sessionId) return
      const scenes = upsertRow(this.snap.scenes, type, row as SceneRow)
      if (scenes !== this.snap.scenes) this.set({ scenes: [...scenes].sort(byPosition) })
      return
    }
    const key = table === 'scene_zones' ? 'zones' : table === 'scene_aspects' ? 'aspects' : table === 'scene_tokens' ? 'tokens' : null
    if (!key) return
    const ids = type === 'DELETE'
      ? Object.keys(this.snap.contents).filter((s) => (this.snap.contents[s][key] as { id: string }[]).some((x) => x.id === row.id))
      : [row.scene_id as string]
    for (const sceneId of ids) {
      this.setContents(sceneId, (c) => {
        const next = upsertRow(c[key] as { id: string; version: number }[], type, row as { id: string; version: number })
        if (next === c[key]) return c
        return { ...c, [key]: key === 'aspects' ? sortAspects(next as SceneAspectRow[]) : next }
      })
    }
  }

  // ---- writes (GM; RLS refuses anyone else) -------------------------------------------

  private async run(sceneId: string | null, op: PromiseLike<{ error: unknown }>) {
    const { error } = await op
    if (error) {
      toast(friendlyError(error), 'error')
      if (sceneId) void this.loadScene(sceneId, true)
      else void this.load()
    }
    return !error
  }

  async createScene(name: string, kind: SceneKind): Promise<string | null> {
    const position = positionBetween(this.snap.scenes.at(-1)?.position, null)
    const { data, error } = await supabase.from('scenes').insert({ session_id: this.sessionId, name, kind, position })
      .select(SCENE_COLUMNS).single<SceneRow>()
    if (error) {
      toast(friendlyError(error), 'error')
      return null
    }
    this.applyRemote('scenes', 'INSERT', data)
    return data.id
  }

  patchScene(id: string, patch: Partial<Pick<SceneRow, 'name' | 'kind' | 'position'>>) {
    this.set({ scenes: this.snap.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)).sort(byPosition) })
    return this.run(null, supabase.from('scenes').update(patch).eq('id', id))
  }

  async deleteScene(id: string) {
    this.set({ scenes: this.snap.scenes.filter((s) => s.id !== id) })
    return this.run(null, supabase.from('scenes').delete().eq('id', id))
  }

  async duplicateScene(id: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('duplicate_scene', { p_scene_id: id })
    if (error) {
      toast(friendlyError(error), 'error')
      return null
    }
    await this.load()
    return data as string
  }

  setActive(sceneId: string | null) {
    return this.run(null, supabase.from('sessions').update({ active_scene_id: sceneId }).eq('id', this.sessionId))
  }

  // zones
  async addZone(sceneId: string, zone: Pick<ZoneRow, 'title' | 'x' | 'y' | 'w' | 'h'>) {
    const z = Math.max(0, ...(this.snap.contents[sceneId]?.zones.map((x) => x.z) ?? [0])) + 1
    const { data, error } = await supabase.from('scene_zones').insert({ scene_id: sceneId, ...zone, z }).select(ZONE_COLUMNS).single<ZoneRow>()
    if (error) return toast(friendlyError(error), 'error')
    this.applyRemote('scene_zones', 'INSERT', data)
  }
  patchZone(sceneId: string, id: string, patch: Partial<Pick<ZoneRow, 'title' | 'color' | 'x' | 'y' | 'w' | 'h' | 'z'>>) {
    this.setContents(sceneId, (c) => ({ ...c, zones: c.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }))
    return this.run(sceneId, supabase.from('scene_zones').update(patch).eq('id', id))
  }
  bringToFront(sceneId: string, id: string) {
    const zones = this.snap.contents[sceneId]?.zones ?? []
    const top = Math.max(0, ...zones.map((z) => z.z))
    if (zones.find((z) => z.id === id)?.z === top && zones.filter((z) => z.z === top).length === 1) return
    this.setContents(sceneId, (c) => ({ ...c, zones: c.zones.map((z) => (z.id === id ? { ...z, z: top + 1 } : z)) }))
    return this.run(sceneId, supabase.rpc('bring_to_front', { p_zone_id: id }))
  }
  deleteZone(sceneId: string, id: string) {
    // The database moves its aspects to scene level (on delete set null); mirror that.
    this.setContents(sceneId, (c) => ({
      ...c,
      zones: c.zones.filter((z) => z.id !== id),
      aspects: c.aspects.map((a) => (a.zone_id === id ? { ...a, zone_id: null } : a)),
    }))
    return this.run(sceneId, supabase.from('scene_zones').delete().eq('id', id))
  }

  // aspects
  async addAspect(sceneId: string, text: string, zoneId: string | null = null) {
    const siblings = (this.snap.contents[sceneId]?.aspects ?? []).filter((a) => a.zone_id === zoneId)
    const { data, error } = await supabase.from('scene_aspects')
      .insert({ scene_id: sceneId, zone_id: zoneId, text: text.slice(0, 200), position: positionBetween(siblings.at(-1)?.position, null) })
      .select(SCENE_ASPECT_COLUMNS).single<SceneAspectRow>()
    if (error) return toast(friendlyError(error), 'error')
    this.applyRemote('scene_aspects', 'INSERT', data)
  }
  patchAspect(sceneId: string, id: string, patch: Partial<Pick<SceneAspectRow, 'text' | 'free_invokes' | 'zone_id' | 'position'>>) {
    this.setContents(sceneId, (c) => ({ ...c, aspects: sortAspects(c.aspects.map((a) => (a.id === id ? { ...a, ...patch } : a))) }))
    return this.run(sceneId, supabase.from('scene_aspects').update(patch).eq('id', id))
  }
  deleteAspect(sceneId: string, id: string) {
    this.setContents(sceneId, (c) => ({ ...c, aspects: c.aspects.filter((a) => a.id !== id) }))
    return this.run(sceneId, supabase.from('scene_aspects').delete().eq('id', id))
  }

  // tokens
  async addTokens(sceneId: string, tokens: Pick<TokenRow, 'character_id' | 'label' | 'color' | 'x' | 'y'>[]) {
    if (!tokens.length) return
    const { data, error } = await supabase.from('scene_tokens').insert(tokens.map((t) => ({ scene_id: sceneId, ...t })))
      .select(TOKEN_COLUMNS).returns<TokenRow[]>()
    if (error) return toast(friendlyError(error), 'error')
    for (const t of data ?? []) this.applyRemote('scene_tokens', 'INSERT', t)
  }
  patchToken(sceneId: string, id: string, patch: Partial<Pick<TokenRow, 'label' | 'color' | 'x' | 'y'>>) {
    this.setContents(sceneId, (c) => ({ ...c, tokens: c.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    return this.run(sceneId, supabase.from('scene_tokens').update(patch).eq('id', id))
  }
  deleteToken(sceneId: string, id: string) {
    this.setContents(sceneId, (c) => ({ ...c, tokens: c.tokens.filter((t) => t.id !== id) }))
    return this.run(sceneId, supabase.from('scene_tokens').delete().eq('id', id))
  }
}

const stores = new Map<string, ScenesStore>()
export function getScenesStore(sessionId: string): ScenesStore {
  let s = stores.get(sessionId)
  if (!s) {
    s = new ScenesStore(sessionId)
    stores.set(sessionId, s)
  }
  return s
}

export function useScenes(sessionId: string) {
  const store = getScenesStore(sessionId)
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { store, ...snap }
}
