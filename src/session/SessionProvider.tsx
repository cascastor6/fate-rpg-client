import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { clearLastSession, setLastSession } from '../lib/storage.ts'
import { ensureAnonymousUser, supabase } from '../lib/supabase.ts'
import { Button, FullScreenSpinner, Notice } from '../ui/primitives.tsx'
import type { Member, SessionRow } from './types.ts'

type SessionContextValue = {
  uid: string
  session: SessionRow
  members: Member[]
  me: Member
  isGm: boolean
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
  | { kind: 'ready'; uid: string; session: SessionRow; members: Member[] }

/**
 * Loads one session for the current anonymous user. If the user isn't (or is no
 * longer) a member, forgets the session and goes home. Realtime arrives in Slice 5.
 */
export function SessionProvider({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async () => {
    try {
      const uid = await ensureAnonymousUser()
      const [s, m] = await Promise.all([
        supabase.from('sessions').select('id,name,invite_code,gm_fate_points,gm_roll_mode,active_scene_id,spotlight,version')
          .eq('id', sessionId).maybeSingle<SessionRow>(),
        supabase.from('session_members').select('*').eq('session_id', sessionId).order('joined_at').returns<Member[]>(),
      ])
      if (s.error) throw s.error
      if (m.error) throw m.error
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
      setState({ kind: 'ready', uid, session: s.data, members: m.data ?? [] })
    } catch (e) {
      setState({ kind: 'error', message: friendlyError(e) })
    }
  }, [sessionId, navigate])

  useEffect(() => {
    void load()
  }, [load])

  const value = useMemo<SessionContextValue | null>(() => {
    if (state.kind !== 'ready') return null
    const me = state.members.find((x) => x.user_id === state.uid)!
    return {
      uid: state.uid,
      session: state.session,
      members: state.members,
      me,
      isGm: me.role === 'gm',
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
  }, [state, load, navigate, sessionId])

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

