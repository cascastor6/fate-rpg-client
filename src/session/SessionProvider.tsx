import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { clearLastSession, setLastSession } from '../lib/storage.ts'
import { ensureAnonymousUser, supabase } from '../lib/supabase.ts'
import { Button, FullScreenSpinner, Notice } from '../ui/primitives.tsx'
import { CHARACTER_COLUMNS, type CharacterRow } from '../sheet/types.ts'
import { upsertRow, type RemoteChange } from '../sheet/remote.ts'
import { getDiceStore } from '../dice/store.ts'
import { peekSheetStore, resyncSheets } from '../sheet/store.ts'
import { openSessionChannel, type Change, type ConnectionState } from './realtime.ts'
import { toast } from '../ui/toast.tsx'
import { SCENE_ASPECT_COLUMNS, type Member, type SceneAspectRow, type SessionRow } from './types.ts'

type SessionContextValue = {
  uid: string
  session: SessionRow
  members: Member[]
  /** PCs, plus NPCs the caller may see (RLS), ordered by position */
  characters: CharacterRow[]
  /** aspects of the active scene, in order */
  sceneAspects: SceneAspectRow[]
  me: Member
  isGm: boolean
  /** realtime connection (SPEC §10) */
  connection: ConnectionState
  memberName: (userId: string | null) => string | null
  refresh: () => Promise<void>
  updateMe: (patch: Partial<Pick<Member, 'display_name' | 'color'>>) => Promise<void>
  leave: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; uid: string; session: SessionRow; members: Member[]; characters: CharacterRow[]; sceneAspects: SceneAspectRow[] }

/**
 * Loads one session for the current anonymous user and keeps it live over realtime.
 * If the user isn't (or is no longer) a member, forgets the session and goes home.
 */
export function SessionProvider({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const loadedOnce = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  /** Fetch everything. After the first load, failures keep the current state (e.g. offline). */
  const load = useCallback(async () => {
    try {
      const uid = await ensureAnonymousUser()
      const [s, m, c] = await Promise.all([
        supabase.from('sessions').select('id,name,invite_code,gm_fate_points,gm_roll_mode,active_scene_id,spotlight,version')
          .eq('id', sessionId).maybeSingle<SessionRow>(),
        supabase.from('session_members').select('*').eq('session_id', sessionId).order('joined_at').returns<Member[]>(),
        supabase.from('characters').select(CHARACTER_COLUMNS).eq('session_id', sessionId)
          .order('position').order('id').returns<CharacterRow[]>(),
      ])
      if (s.error) throw s.error
      if (m.error) throw m.error
      if (c.error) throw c.error
      let sceneAspects: SceneAspectRow[] = []
      if (s.data?.active_scene_id) {
        const a = await supabase.from('scene_aspects').select(SCENE_ASPECT_COLUMNS).eq('scene_id', s.data.active_scene_id)
          .order('position').returns<SceneAspectRow[]>()
        if (a.error) throw a.error
        sceneAspects = a.data ?? []
      }
      const me = m.data?.find((x) => x.user_id === uid)
      if (!s.data || !me) {
        // RLS hides sessions you're not in, so "missing" and "not a member" look the same.
        clearLastSession(sessionId)
        navigate('/', { replace: true, state: { notice: 'You’re not in that session (any more). Join again with the invite link.' } })
        return
      }
      setLastSession({
        sessionId,
        sessionName: s.data.name,
        inviteCode: s.data.invite_code,
        role: me.role,
        displayName: me.display_name,
      })
      setState({ kind: 'ready', uid, session: s.data, members: m.data ?? [], characters: c.data ?? [], sceneAspects })
      loadedOnce.current = true
    } catch (e) {
      if (!loadedOnce.current) setState({ kind: 'error', message: friendlyError(e) })
    }
  }, [sessionId, navigate])

  useEffect(() => {
    void load()
  }, [load])

  // Realtime: open once we know who we are.
  const uid = state.kind === 'ready' ? state.uid : null
  useEffect(() => {
    if (!uid) return
    const onChange = (c: Change) => {
      const row = c.row
      switch (c.table) {
        case 'sessions':
          setState((prev) => {
            if (prev.kind !== 'ready' || (row.version as number) <= prev.session.version) return prev
            if (row.active_scene_id !== prev.session.active_scene_id) void load() // new scene: its aspects
            return { ...prev, session: { ...prev.session, ...(row as SessionRow) } }
          })
          return
        case 'scene_aspects':
          setState((prev) => {
            if (prev.kind !== 'ready') return prev
            if (c.type !== 'DELETE' && row.scene_id !== prev.session.active_scene_id) return prev
            const next = upsertRow(prev.sceneAspects, c.type, row as SceneAspectRow)
            return next === prev.sceneAspects ? prev
              : { ...prev, sceneAspects: [...next].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)) }
          })
          return
        case 'scenes':
          return
        case 'session_members': {
          if (row.session_id !== sessionId) return
          if (c.type === 'DELETE' && row.user_id === uid) {
            clearLastSession(sessionId)
            navigate('/', { replace: true, state: { notice: 'You’re no longer in that session. The GM may have removed you.' } })
            return
          }
          setState((prev) => {
            if (prev.kind !== 'ready') return prev
            const others = prev.members.filter((m) => m.user_id !== row.user_id)
            const members = c.type === 'DELETE' ? others
              : [...others, row as Member].sort((a, b) => a.joined_at.localeCompare(b.joined_at))
            return { ...prev, members }
          })
          return
        }
        case 'characters': {
          setState((prev) => {
            if (prev.kind !== 'ready') return prev
            if (c.type !== 'DELETE' && row.session_id !== sessionId) return prev
            const characters = upsertRow(prev.characters, c.type, row as CharacterRow)
            if (characters === prev.characters) return prev
            return { ...prev, characters: [...characters].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)) }
          })
          peekSheetStore(row.id as string)?.applyRemote({ table: 'characters', type: c.type, row } as RemoteChange)
          return
        }
        case 'sheet_sections':
        case 'sheet_blocks':
          peekSheetStore(row.character_id as string)?.applyRemote({ table: c.table, type: c.type, row } as RemoteChange)
          return
        case 'rolls':
          getDiceStore(sessionId).applyRemote(c.table, c.type, row)
          return
        case 'session_events': {
          getDiceStore(sessionId).applyRemote(c.table, c.type, row)
          if (c.type === 'INSERT') eventToast(row)
          // Something became hidden from us (we can't receive its UPDATE), or visible: refetch.
          const table = (row.payload as { table?: string } | null)?.table
          if (c.type === 'INSERT' && row.kind === 'visibility_changed' && table !== 'rolls') {
            void load()
            resyncSheets()
          }
          return
        }
      }
    }
    // Toasts for things other people did (SPEC §9.4).
    const eventToast = (row: Record<string, unknown>) => {
      const prev = stateRef.current
      if (prev.kind !== 'ready') return
      const p = (row.payload ?? {}) as Record<string, unknown>
      const amGm = prev.members.find((m) => m.user_id === uid)?.role === 'gm'
      const target = prev.characters.find((ch) => ch.id === row.target_character_id)
      if ((row.kind === 'fate_point_awarded' || row.kind === 'fate_point_taken') && target?.owner_id === uid) {
        const n = Math.abs(Number(p.delta) || 1)
        const what = n === 1 ? 'a fate point' : `${n} fate points`
        toast(row.kind === 'fate_point_awarded' ? `The GM gave you ${what}.` : `The GM took ${what}.`)
        navigator.vibrate?.(40)
      } else if (row.kind === 'scene_aspect_added' && !amGm) {
        toast(`New scene aspect: ${String(p.text ?? '')}`)
      } else if (row.kind === 'member_joined' && amGm) {
        toast(`${String(p.display_name ?? 'Someone')} joined.`)
      }
    }
    return openSessionChannel(sessionId, {
      onChange,
      onState: setConnection,
      onResync: () => {
        void load()
        resyncSheets()
        void getDiceStore(sessionId).load()
      },
    })
  }, [uid, sessionId, navigate, load])

  const value = useMemo<SessionContextValue | null>(() => {
    if (state.kind !== 'ready') return null
    const me = state.members.find((x) => x.user_id === state.uid)!
    return {
      uid: state.uid,
      session: state.session,
      members: state.members,
      characters: state.characters,
      sceneAspects: state.sceneAspects,
      me,
      isGm: me.role === 'gm',
      connection,
      memberName: (userId) => state.members.find((x) => x.user_id === userId)?.display_name ?? null,
      refresh: load,
      async updateMe(patch) {
        const { error } = await supabase.from('session_members').update(patch)
          .eq('session_id', sessionId).eq('user_id', state.uid)
        if (error) throw error
        setState((prev) =>
          prev.kind === 'ready'
            ? { ...prev, members: prev.members.map((x) => (x.user_id === state.uid ? { ...x, ...patch } : x)) }
            : prev,
        )
      },
      async leave() {
        const { error } = await supabase.from('session_members').delete()
          .eq('session_id', sessionId).eq('user_id', state.uid)
        if (error) throw error
        clearLastSession(sessionId)
        navigate('/', { replace: true, state: { notice: `You left “${state.session.name}”.` } })
      },
    }
  }, [state, load, navigate, sessionId, connection])

  if (state.kind === 'loading') return <FullScreenSpinner label="Opening session…" />
  if (state.kind === 'error') {
    return (
      <main className="mx-auto flex max-w-screen-sm flex-col gap-4 px-4 py-10">
        <Notice tone="error">{state.message}</Notice>
        <div className="flex gap-2">
          <Button onClick={() => { setState({ kind: 'loading' }); void load() }}>Try again</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>Home</Button>
        </div>
      </main>
    )
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

