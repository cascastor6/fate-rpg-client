// Per-character sheet store: server copy + pending ops = what the UI shows (SPEC §6.3).
// Ops are sent one at a time, in order. Offline failures stay queued and retry;
// rejected ops are dropped (the view falls back to the server copy) with a toast.
// Realtime (Slice 5) and a persisted queue (Slice 8) plug into this same store.

import { friendlyError, isNetworkError } from '../lib/errors.ts'
import { byPosition } from '../lib/positions.ts'
import { supabase } from '../lib/supabase.ts'
import { toast } from '../ui/toast.tsx'
import { applyOp, isDebounced, sortSheet, tryMerge, type SheetData, type SheetOp, type SheetOpBody } from './ops.ts'
import { mergeRemote, type RemoteChange } from './remote.ts'
import { BLOCK_COLUMNS, CHARACTER_COLUMNS, SECTION_COLUMNS, type BlockRow, type CharacterRow, type SectionRow } from './types.ts'

export const DEBOUNCE_MS = 400
const RETRY_MS = 3000

export type SheetSnapshot =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SheetData; pending: number; offline: boolean }

let opCounter = 0

export class SheetStore {
  private server: SheetData | null = null
  private pending: SheetOp[] = []
  private snapshot: SheetSnapshot = { status: 'loading' }
  private listeners = new Set<() => void>()
  private sending = false
  private offline = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private loading: Promise<void> | null = null
  readonly characterId: string

  constructor(characterId: string) {
    this.characterId = characterId
    window.addEventListener('online', () => this.pump())
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getSnapshot = () => this.snapshot

  /** Fetch character, sections and blocks. Keeps pending ops on top of the fresh copy. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const fresh = await this.fetchAll()
        if (!fresh) {
          this.server = null
          this.set({ status: 'missing' })
          return
        }
        this.server = fresh
        this.recompute()
      } catch (e) {
        if (!this.server) this.set({ status: 'error', message: friendlyError(e) })
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  private async fetchAll(): Promise<SheetData | null> {
    const id = this.characterId
    const [c, s, b] = await Promise.all([
      supabase.from('characters').select(CHARACTER_COLUMNS).eq('id', id).maybeSingle<CharacterRow>(),
      supabase.from('sheet_sections').select(SECTION_COLUMNS).eq('character_id', id).returns<SectionRow[]>(),
      supabase.from('sheet_blocks').select(BLOCK_COLUMNS).eq('character_id', id).returns<BlockRow[]>(),
    ])
    const err = c.error ?? s.error ?? b.error
    if (err) throw err
    if (!c.data) return null
    return { character: c.data, sections: (s.data ?? []).sort(byPosition), blocks: (b.data ?? []).sort(byPosition) }
  }

  /** Fold a realtime change into the server copy; pending local ops stay on top. */
  applyRemote(change: RemoteChange) {
    if (!this.server) return
    const next = mergeRemote(this.server, change)
    if (next === this.server) return
    this.server = next
    this.recompute()
  }

  /** True if this store has anything loaded worth refreshing. */
  get loaded() {
    return this.server !== null
  }

  /** Apply an edit locally right away and queue it for the server. */
  enqueue(body: SheetOpBody) {
    const now = Date.now()
    const last = this.pending[this.pending.length - 1]
    const merged = tryMerge(last, body)
    if (merged && last) {
      this.pending[this.pending.length - 1] = { ...merged, opId: last.opId, touchedAt: now }
    } else {
      this.pending.push({ ...body, opId: `op${++opCounter}`, touchedAt: now })
    }
    this.recompute()
    this.pump()
  }

  private set(s: SheetSnapshot) {
    this.snapshot = s
    for (const l of this.listeners) l()
  }

  private recompute() {
    if (!this.server) return
    const data = sortSheet(this.pending.reduce<SheetData>((d, op) => applyOp(d, op), this.server))
    this.set({ status: 'ready', data, pending: this.pending.length, offline: this.offline })
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.pump()
    }, ms)
  }

  private async pump() {
    if (this.sending || !this.server) return
    const head = this.pending[0]
    if (!head) return
    if (isDebounced(head) && this.pending.length === 1) {
      const wait = head.touchedAt + DEBOUNCE_MS - Date.now()
      if (wait > 0) return this.schedule(wait)
    }
    this.sending = true
    head.sent = true
    try {
      await this.send(head)
      this.pending.shift()
      if (this.offline) toast('Back online. Changes saved.')
      this.offline = false
    } catch (e) {
      if (isNetworkError(e)) {
        head.sent = false
        if (!this.offline) toast('You’re offline. Changes will save when you reconnect.')
        this.offline = true
        this.sending = false
        this.recompute()
        return this.schedule(RETRY_MS)
      }
      this.pending.shift()
      toast(friendlyError(e), 'error')
    }
    this.sending = false
    this.recompute()
    if (this.pending.length) this.pump()
  }

  /** Send one op and fold the server's answer into the server copy. */
  private async send(op: SheetOp) {
    const id = this.characterId
    const server = this.server!
    // Note: 'rebalance' and 'replace' swap this.server for a fresh copy.
    const replaceBlock = (row: BlockRow) => {
      server.blocks = server.blocks.map((b) => (b.id === row.id ? row : b))
    }
    switch (op.kind) {
      case 'patch': {
        const { data, error } = await supabase.rpc('patch_block', { p_character_id: id, p_block_id: op.blockId, p_patch: op.patch })
        if (error) throw error
        return replaceBlock(data as BlockRow)
      }
      case 'stress': {
        const { data, error } = await supabase.rpc('set_stress_box', {
          p_character_id: id, p_block_id: op.blockId, p_index: op.index, p_checked: op.checked,
        })
        if (error) throw error
        return replaceBlock(data as BlockRow)
      }
      case 'adjust': {
        if (op.delta === 0) return
        const { data, error } = await supabase.rpc('adjust_block_value', { p_character_id: id, p_block_id: op.blockId, p_delta: op.delta })
        if (error) throw error
        return replaceBlock(data as BlockRow)
      }
      case 'fate': {
        if (op.delta === 0) return
        const { data, error } = await supabase.rpc('adjust_fate_points', { p_character_id: id, p_delta: op.delta })
        if (error) throw error
        server.character = { ...server.character, fate_points: data as number }
        return
      }
      case 'insert_block': {
        const { character_id, id: bid, section_id, type, label, value, props, position } = op.block
        const { data, error } = await supabase.from('sheet_blocks')
          .insert({ character_id, id: bid, section_id, type, label, value, props, position })
          .select(BLOCK_COLUMNS).single<BlockRow>()
        if (error) throw error
        server.blocks = [...server.blocks.filter((b) => b.id !== data.id), data]
        return
      }
      case 'delete_block': {
        const { error } = await supabase.from('sheet_blocks').delete().eq('character_id', id).eq('id', op.blockId)
        if (error) throw error
        server.blocks = server.blocks.filter((b) => b.id !== op.blockId)
        return
      }
      case 'insert_section': {
        const { id: sid, title, position } = op.section
        const { data, error } = await supabase.from('sheet_sections')
          .insert({ character_id: id, id: sid, title, position })
          .select(SECTION_COLUMNS).single<SectionRow>()
        if (error) throw error
        server.sections = [...server.sections.filter((x) => x.id !== data.id), data]
        return
      }
      case 'patch_section': {
        const { data, error } = await supabase.from('sheet_sections').update(op.patch)
          .eq('character_id', id).eq('id', op.sectionId).select(SECTION_COLUMNS).maybeSingle<SectionRow>()
        if (error) throw error
        if (!data) throw new Error('not_found')
        server.sections = server.sections.map((x) => (x.id === data.id ? data : x))
        return
      }
      case 'delete_section': {
        const { error } = await supabase.rpc('delete_section', {
          p_character_id: id, p_section_id: op.sectionId, p_with_blocks: op.withBlocks,
        })
        if (error) throw error
        server.sections = server.sections.filter((x) => x.id !== op.sectionId)
        server.blocks = server.blocks.filter((b) => b.section_id !== op.sectionId)
        return
      }
      case 'rebalance':
      case 'replace': {
        const { error } = op.kind === 'rebalance'
          ? await supabase.rpc('rebalance_positions', { p_character_id: id })
          : await supabase.rpc('replace_sheet', { p_character_id: id, p_sheet: op.sheet })
        if (error) throw error
        const fresh = await this.fetchAll()
        if (fresh) this.server = fresh
        return
      }
      case 'character': {
        const { data, error } = await supabase.from('characters').update(op.patch).eq('id', id)
          .select(CHARACTER_COLUMNS).maybeSingle<CharacterRow>()
        if (error) throw error
        if (!data) throw new Error('not_allowed')
        server.character = data
        return
      }
    }
  }
}

const stores = new Map<string, SheetStore>()

/** The store for a character, if one exists (doesn't create it). */
export function peekSheetStore(characterId: string | undefined): SheetStore | undefined {
  return characterId ? stores.get(characterId) : undefined
}

/** Refetch every loaded sheet (after a reconnect), and retry anything queued. */
export function resyncSheets() {
  for (const s of stores.values()) if (s.loaded) void s.load()
}

export function getSheetStore(characterId: string): SheetStore {
  let s = stores.get(characterId)
  if (!s) {
    s = new SheetStore(characterId)
    stores.set(characterId, s)
  }
  return s
}
