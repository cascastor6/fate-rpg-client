import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { GM_CODE_PROBLEM_TEXT, gmCodeProblem, normalizeGmCode, suggestGmCode } from '../lib/gmCode.ts'
import { extractInviteCode, isValidInviteCode } from '../lib/invite.ts'
import { clearLastSession, getLastSession, setLastSession, type LastSession } from '../lib/storage.ts'
import { ensureAnonymousUser, isConfigured, supabase, withFreshUserRetry } from '../lib/supabase.ts'
import { ColorPicker } from '../ui/ColorPicker.tsx'
import type { PlayerColor } from '../ui/colors.ts'
import { Button, Card, Notice, TextField } from '../ui/primitives.tsx'
import { ThemeSwitch } from '../ui/ThemeSwitch.tsx'

export default function Home() {
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const [last, setLast] = useState<LastSession | null>(() => getLastSession())
  const [authError, setAuthError] = useState<string | null>(null)

  // Sign in early so problems (e.g. anonymous sign-ins disabled) show up right away.
  useEffect(() => {
    if (!isConfigured) return
    ensureAnonymousUser().catch((e) => setAuthError(friendlyError(e)))
  }, [])

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-full max-w-screen-sm flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Fate Table</h1>
        <p className="mt-1 text-[color:var(--muted)]">Run Fate Core, Accelerated and Condensed sessions together.</p>
      </header>

      {notice && <Notice>{notice}</Notice>}

      {!isConfigured ? (
        <Notice tone="error">
          <strong>Supabase isn’t configured.</strong> Copy <code>.env.example</code> to <code>.env.local</code>, add your
          project URL and anon key, then restart <code>npm run dev</code>. See the README.
        </Notice>
      ) : (
        <>
          {authError && (
            <Notice tone="error">
              <strong>Couldn’t sign in:</strong> {authError} Check that anonymous sign-ins are enabled in Supabase
              (Authentication → Sign In / Providers).
            </Notice>
          )}
          {last && <ResumeCard last={last} onForget={() => { clearLastSession(); setLast(null) }} />}
          <JoinCard />
          <GmCard />
        </>
      )}
      <footer className="mt-auto pt-6"><ThemeSwitch /></footer>
    </main>
  )
}

function ResumeCard({ last, onForget }: { last: LastSession; onForget: () => void }) {
  return (
    <Card className="border-amber-500">
      <p className="text-sm font-medium uppercase tracking-wide text-[color:var(--muted)]">Continue</p>
      <h2 className="mt-1 truncate text-xl font-bold">{last.sessionName}</h2>
      <p className="text-sm text-[color:var(--muted)]">
        {last.role === 'gm' ? 'As GM' : `As ${last.displayName}`} · code {last.inviteCode}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={`/s/${last.sessionId}`}
          className="inline-flex min-h-11 items-center rounded-xl bg-amber-700 px-5 font-medium text-white hover:bg-amber-800"
        >
          Continue
        </Link>
        <Button variant="ghost" onClick={onForget}>Forget</Button>
      </div>
    </Card>
  )
}

function JoinCard() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const code = extractInviteCode(input)
    if (!isValidInviteCode(code)) {
      setError('Invite codes are 6 letters and numbers, like K7QPMX.')
      return
    }
    navigate(`/join/${code}`)
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">Join a game</h2>
      <form className="mt-3 flex items-start gap-2" onSubmit={submit}>
        <TextField
          className="flex-1"
          label="Invite code or link"
          placeholder="K7QPMX"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null) }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          error={error}
        />
        <Button type="submit" className="mt-6" disabled={!input.trim()}>Join</Button>
      </form>
    </Card>
  )
}

type GmStep =
  | { kind: 'enter' }
  | { kind: 'create'; code: string }

/**
 * One textbox for both reclaiming and creating (SPEC §3.3): a code that matches a session makes
 * you its GM; an unknown code offers to create a new session with it, after a confirm.
 */
function GmCard() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [suggested, setSuggested] = useState<string | null>(null)
  const [step, setStep] = useState<GmStep>({ kind: 'enter' })
  const [problem, setProblem] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [sessionName, setSessionName] = useState('')
  const [displayName, setDisplayName] = useState(() => getLastSession()?.displayName ?? '')
  const [color, setColor] = useState<PlayerColor>('slate')

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const p = gmCodeProblem(code)
    if (p) {
      setProblem(GM_CODE_PROBLEM_TEXT[p])
      return
    }
    // A freshly suggested code can't belong to a session yet: skip the lookup
    // (and don't spend one of the limited failed attempts on it).
    if (suggested && normalizeGmCode(code) === normalizeGmCode(suggested)) {
      setStep({ kind: 'create', code })
      return
    }
    setBusy(true)
    try {
      await ensureAnonymousUser()
      const { data, error } = await withFreshUserRetry(() => supabase.rpc('claim_gm', { p_gm_code: code }))
      if (error) throw error
      if (data) {
        await rememberGm(data as string)
        navigate(`/s/${data}/gm`)
      } else {
        setStep({ kind: 'create', code })
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function rememberGm(sessionId: string) {
    const { data } = await supabase.from('sessions').select('name,invite_code').eq('id', sessionId).single()
    if (data) {
      setLastSession({ sessionId, sessionName: data.name, inviteCode: data.invite_code, role: 'gm', displayName: 'GM' })
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    if (step.kind !== 'create') return
    setBusy(true)
    setError(null)
    try {
      await ensureAnonymousUser()
      const { data, error } = await withFreshUserRetry(() => supabase.rpc('create_session', {
        p_gm_code: step.code,
        p_name: sessionName.trim(),
        p_display_name: displayName.trim(),
        p_color: color,
      }))
      if (error) throw error
      const { session_id, invite_code } = data as { session_id: string; invite_code: string }
      setLastSession({
        sessionId: session_id,
        sessionName: sessionName.trim(),
        inviteCode: invite_code,
        role: 'gm',
        displayName: displayName.trim(),
      })
      navigate(`/s/${session_id}/gm?new=1`)
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  if (step.kind === 'create') {
    return (
      <Card className="border-amber-500">
        <h2 className="text-lg font-semibold">No session uses this code yet. Create one?</h2>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          GM code: <span className="font-mono text-[color:var(--fg)]">{normalizeGmCode(step.code)}</span>. Write it down:
          it’s how you get back in as GM on any device.
        </p>
        <form className="mt-4 flex flex-col gap-4" onSubmit={create}>
          <TextField
            label="Session name"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            maxLength={80}
            placeholder="The Silver Order"
            autoFocus
            required
          />
          <TextField
            label="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            autoComplete="nickname"
            required
          />
          <ColorPicker value={color} onChange={setColor} />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy} disabled={!sessionName.trim() || !displayName.trim()}>
              Create session
            </Button>
            <Button variant="secondary" onClick={() => { setStep({ kind: 'enter' }); setError(null) }}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">I’m the GM</h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Enter your GM code to get back into your session, or choose a new code to start one.
      </p>
      <form className="mt-3 flex flex-col gap-3" onSubmit={submitCode}>
        <TextField
          label="GM code"
          value={code}
          onChange={(e) => { setCode(e.target.value); setProblem(null); setError(null) }}
          placeholder="ember lantern otter quarry"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={problem}
          hint="At least 10 characters. A few random words work well. Case and spacing don’t matter."
        />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy} disabled={!code.trim()}>Continue</Button>
          <Button
            variant="secondary"
            onClick={() => {
              const s = suggestGmCode()
              setCode(s)
              setSuggested(s)
              setProblem(null)
              setError(null)
            }}
          >
            Suggest one
          </Button>
        </div>
      </form>
    </Card>
  )
}

