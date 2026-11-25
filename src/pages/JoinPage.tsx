import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { errorCode, friendlyError } from '../lib/errors.ts'
import { extractInviteCode, isValidInviteCode } from '../lib/invite.ts'
import { getLastSession, setLastSession } from '../lib/storage.ts'
import { ensureAnonymousUser, isConfigured, supabase } from '../lib/supabase.ts'
import { ColorPicker } from '../ui/ColorPicker.tsx'
import { firstUnusedColor, isPlayerColor, type PlayerColor } from '../ui/colors.ts'
import { Button, Card, FullScreenSpinner, Notice, TextField } from '../ui/primitives.tsx'

type Preview = { name: string; taken_colors: string[]; already_member: boolean }

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: Preview }

/** /join/:code — pick a display name and colour, then join as a player (SPEC §3.3). */
export default function JoinPage() {
  const params = useParams()
  const code = extractInviteCode(params.code ?? '')
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [name, setName] = useState(() => getLastSession()?.displayName ?? '')
  const [color, setColor] = useState<PlayerColor>('red')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConfigured) {
      setState({ kind: 'error', message: 'Supabase isn’t configured. See the README.' })
      return
    }
    if (!isValidInviteCode(code)) {
      setState({ kind: 'invalid' })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await ensureAnonymousUser()
        const { data, error } = await supabase.rpc('session_preview', { p_invite_code: code })
        if (error) throw error
        if (cancelled) return
        const preview = data as Preview
        setColor(firstUnusedColor(preview.taken_colors))
        setState({ kind: 'ready', preview })
      } catch (e) {
        if (!cancelled) setState(errorCode(e) === 'invalid_invite' ? { kind: 'invalid' } : { kind: 'error', message: friendlyError(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  async function join(e: FormEvent) {
    e.preventDefault()
    if (state.kind !== 'ready') return
    setBusy(true)
    setError(null)
    try {
      const { data: sessionId, error } = await supabase.rpc('join_session', {
        p_invite_code: code,
        p_display_name: name.trim(),
        p_color: color,
      })
      if (error) throw error
      setLastSession({
        sessionId: sessionId as string,
        sessionName: state.preview.name,
        inviteCode: code,
        role: 'player',
        displayName: name.trim(),
      })
      navigate(`/s/${sessionId}`, { replace: true })
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  if (state.kind === 'loading') return <FullScreenSpinner label="Finding session…" />

  return (
    <main className="mx-auto flex min-h-full max-w-screen-sm flex-col gap-5 px-4 py-8">
      <Link to="/" className="text-sm text-[color:var(--muted)] underline-offset-4 hover:underline">← Fate Table</Link>

      {state.kind === 'invalid' && (
        <Card>
          <h1 className="text-xl font-bold">No session with that code</h1>
          <p className="mt-2 text-[color:var(--muted)]">
            Check the invite link or code <span className="font-mono">{code || '(empty)'}</span> with your GM.
          </p>
          <Link to="/" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-amber-700 px-4 font-medium text-white">
            Enter a code
          </Link>
        </Card>
      )}

      {state.kind === 'error' && <Notice tone="error">{state.message}</Notice>}

      {state.kind === 'ready' && (
        <Card>
          <p className="text-sm font-medium uppercase tracking-wide text-[color:var(--muted)]">Join session</p>
          <h1 className="mt-1 text-2xl font-bold">{state.preview.name}</h1>
          {state.preview.already_member && (
            <p className="mt-2 text-sm text-[color:var(--muted)]">You’re already in this session; joining again just updates your name and colour.</p>
          )}
          <form className="mt-5 flex flex-col gap-5" onSubmit={join}>
            <TextField
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="nickname"
              autoFocus
              required
              hint="This is how the GM and other players see you."
            />
            <ColorPicker
              value={color}
              onChange={setColor}
              takenBy={Object.fromEntries(state.preview.taken_colors.filter(isPlayerColor).map((c) => [c, true]))}
            />
            <p className="-mt-3 text-sm text-[color:var(--muted)]">Your dice roll in this colour. Dotted colours are already taken.</p>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" busy={busy} disabled={!name.trim()}>
              Join as {name.trim() || 'player'}
            </Button>
          </form>
        </Card>
      )}
    </main>
  )
}
