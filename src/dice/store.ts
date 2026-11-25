// Per-session dice state (SPEC §7): roll log, the animation queue, and rolling.
// Results are always decided by the roll_dice RPC; this store only shows them.

import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { toast } from '../ui/toast.tsx'
import { ROLL_COLUMNS, type HiddenRoll, type LogEntry, type RollRow } from './types.ts'

export const LOG_LIMIT = 50

/** One thing for the dice tray to show: a real roll, or a closed GM roll (face-down). */
export type Animation =
  | { key: string; kind: 'roll'; roll: RollRow; revealed?: boolean }
  | { key: string; kind: 'hidden'; hidden: HiddenRoll }

export type RollRequest = {
  characterId?: string
  blockId?: string
  bonus?: number
  label?: string
  /** GM only; undefined = the session's open/closed setting */
  hidden?: boolean
}

export type DialogState = { characterId?: string } | null

export type DiceSnapshot = {
  log: LogEntry[]
  queue: Animation[]
  rolling: boolean
  dialog: DialogState
  logOpen: boolean
}

const entryId = (e: LogEntry) => (e.kind === 'roll' ? e.roll.id : e.hidden.id)
const entryTime = (e: LogEntry) => (e.kind === 'roll' ? e.roll.created_at : e.hidden.created_at)

export class DiceStore {
  private snap: DiceSnapshot = { log: [], queue: [], rolling: false, dialog: null, logOpen: false }
  private listeners = new Set<() => void>()
  /** ids already animated here, so the roller's realtime echo doesn't play twice */
  private animated = new Set<string>()
  private loaded = false
  readonly sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap

  private set(patch: Partial<DiceSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const l of this.listeners) l()
  }

  /** Latest rolls (RLS hides closed GM rolls from players) + placeholders for those. No animation. */
  async load() {
    const [r, e] = await Promise.all([
      supabase.from('rolls').select(ROLL_COLUMNS).eq('session_id', this.sessionId)
        .order('created_at', { ascending: false }).limit(LOG_LIMIT).returns<RollRow[]>(),
      supabase.from('session_events').select('payload,created_at').eq('session_id', this.sessionId).eq('kind', 'hidden_roll')
        .order('created_at', { ascending: false }).limit(LOG_LIMIT),
    ])
    if (r.error || e.error) return
    const rolls = r.data ?? []
    const known = new Set(rolls.map((x) => x.id))
    const hidden: LogEntry[] = (e.data ?? [])
      .map((ev) => ({ ...(ev.payload as Omit<HiddenRoll, 'id' | 'created_at'> & { roll_id: string }), created_at: ev.created_at as string }))
      .filter((h) => !known.has(h.roll_id))
      .map((h) => ({ kind: 'hidden', hidden: { id: h.roll_id, roller_name: h.roller_name, roller_color: h.roller_color, created_at: h.created_at } }))
    const log = [...rolls.map<LogEntry>((roll) => ({ kind: 'roll', roll })), ...hidden]
      .sort((a, b) => entryTime(b).localeCompare(entryTime(a)))
      .slice(0, LOG_LIMIT)
    for (const x of log) this.animated.add(entryId(x)) // history never replays
    this.loaded = true
    this.set({ log })
  }

  ensureLoaded() {
    if (!this.loaded) void this.load()
  }

  /** Ask the server to roll. Ignored while a roll of ours is already in flight. */
  async roll(req: RollRequest = {}) {
    if (this.snap.rolling) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast('You’re offline. Rolling needs a connection.', 'error')
      return
    }
    this.set({ rolling: true })
    try {
      const { data, error } = await supabase.rpc('roll_dice', {
        p_session_id: this.sessionId,
        p_character_id: req.characterId ?? null,
        p_block_id: req.blockId ?? null,
        p_bonus: req.bonus ?? 0,
        p_label: req.label ?? null,
        p_hidden: req.hidden ?? null,
      })
      if (error) throw error
      this.addRoll(data as RollRow, true)
    } catch (e) {
      toast(friendlyError(e), 'error')
    } finally {
      // Stay "rolling" until our animation has been queued; the tray clears it on landing.
      if (this.snap.rolling && !this.snap.queue.length) this.set({ rolling: false })
    }
  }

  async reveal(rollId: string) {
    const { data, error } = await supabase.rpc('reveal_roll', { p_roll_id: rollId })
    if (error) return toast(friendlyError(error), 'error')
    this.upsertRoll(data as RollRow)
  }

  /** Realtime: rolls INSERT/UPDATE, and hidden_roll / visibility_changed events. */
  applyRemote(table: string, type: string, row: Record<string, unknown>) {
    if (table === 'rolls' && type === 'INSERT') return this.addRoll(row as RollRow, true)
    if (table === 'rolls' && type === 'UPDATE') return this.upsertRoll(row as RollRow)
    if (table === 'session_events' && type === 'INSERT') {
      const p = row.payload as Record<string, unknown>
      if (row.kind === 'hidden_roll') {
        const hidden: HiddenRoll = {
          id: p.roll_id as string, roller_name: p.roller_name as string,
          roller_color: p.roller_color as string, created_at: row.created_at as string,
        }
        // The GM gets the real row too; only add a placeholder if we don't have it.
        if (this.snap.log.some((e) => entryId(e) === hidden.id)) return
        this.set({ log: [{ kind: 'hidden' as const, hidden }, ...this.snap.log].slice(0, LOG_LIMIT) })
        this.enqueue({ key: `h:${hidden.id}`, kind: 'hidden', hidden })
      } else if (row.kind === 'visibility_changed' && p.table === 'rolls') {
        void this.fetchRoll(p.id as string)
      }
    }
  }

  private async fetchRoll(id: string) {
    const { data } = await supabase.from('rolls').select(ROLL_COLUMNS).eq('id', id).maybeSingle<RollRow>()
    if (data) this.upsertRoll(data)
  }

  private addRoll(roll: RollRow, animate: boolean) {
    if (roll.session_id !== this.sessionId) return
    const existing = this.snap.log.find((e) => entryId(e) === roll.id)
    if (existing?.kind === 'roll') return
    this.set({
      log: existing
        ? this.snap.log.map<LogEntry>((e) => (entryId(e) === roll.id ? { kind: 'roll', roll } : e))
        : [{ kind: 'roll' as const, roll }, ...this.snap.log].slice(0, LOG_LIMIT),
    })
    if (animate && !this.animated.has(roll.id)) this.enqueue({ key: `r:${roll.id}`, kind: 'roll', roll })
  }

  /** A roll we may only have as a placeholder (players) or as hidden (GM) got revealed. */
  private upsertRoll(roll: RollRow) {
    const existing = this.snap.log.find((e) => entryId(e) === roll.id)
    if (!existing) return this.addRoll(roll, true)
    const wasPlaceholder = existing.kind === 'hidden'
    if (existing.kind === 'roll' && existing.roll.is_hidden === roll.is_hidden && existing.roll.revealed_at === roll.revealed_at) return
    this.set({ log: this.snap.log.map<LogEntry>((e) => (entryId(e) === roll.id ? { kind: 'roll', roll } : e)) })
    if (wasPlaceholder) this.enqueue({ key: `v:${roll.id}`, kind: 'roll', roll, revealed: true }, true)
  }

  private enqueue(a: Animation, force = false) {
    const id = a.kind === 'roll' ? a.roll.id : a.hidden.id
    if (!force && a.kind === 'roll' && this.animated.has(id)) return
    this.animated.add(id)
    this.set({ queue: [...this.snap.queue, a] })
  }

  /** The tray calls this when an animation has finished showing. */
  finished(key: string, mine: boolean) {
    this.set({ queue: this.snap.queue.filter((a) => a.key !== key), ...(mine ? { rolling: false } : {}) })
  }

  openDialog(characterId?: string) {
    this.set({ dialog: { characterId } })
  }
  closeDialog() {
    this.set({ dialog: null })
  }
  setLogOpen(open: boolean) {
    this.set({ logOpen: open })
  }
}

const stores = new Map<string, DiceStore>()
export function getDiceStore(sessionId: string): DiceStore {
  let s = stores.get(sessionId)
  if (!s) {
    s = new DiceStore(sessionId)
    stores.set(sessionId, s)
  }
  return s
}
