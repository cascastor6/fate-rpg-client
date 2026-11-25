import { useState } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { inviteUrl } from '../lib/invite.ts'
import { ColorPicker } from '../ui/ColorPicker.tsx'
import { colorOf, type PlayerColor } from '../ui/colors.ts'
import { Button, Card, Notice, TextField } from '../ui/primitives.tsx'
import { useSession } from './SessionProvider.tsx'

/** Invite link with copy / share (SPEC §8.1 members panel). */
export function InvitePanel({ emphasis = false }: { emphasis?: boolean }) {
  const { session } = useSession()
  const url = inviteUrl(session.invite_code)
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard needs HTTPS (or localhost); fall back to selecting the text.
      const el = document.getElementById('invite-url') as HTMLInputElement | null
      el?.select()
    }
  }

  return (
    <Card className={emphasis ? 'border-amber-500' : ''}>
      <h2 className="text-lg font-semibold">Invite players</h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Send this link, or have players enter code{' '}
        <strong className="font-mono text-base tracking-widest text-[color:var(--fg)]">{session.invite_code}</strong> on the home page.
      </p>
      <input
        id="invite-url"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-3 min-h-11 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 font-mono text-sm"
        aria-label="Invite link"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={copy}>{copied ? 'Copied!' : 'Copy link'}</Button>
        {canShare && (
          <Button
            variant="secondary"
            onClick={() => navigator.share({ title: session.name, text: `Join “${session.name}” on Fate Table`, url }).catch(() => {})}
          >
            Share…
          </Button>
        )}
      </div>
    </Card>
  )
}

export function MembersList() {
  const { members, uid } = useSession()
  return (
    <Card>
      <h2 className="text-lg font-semibold">At the table ({members.length})</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {members.map((m) => {
          const c = colorOf(m.color)
          return (
            <li key={m.user_id} className="flex min-h-11 items-center gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: c.fill, color: c.ink }}
                aria-hidden="true"
              >
                {m.display_name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 truncate">
                {m.display_name}
                {m.user_id === uid && <span className="text-[color:var(--muted)]"> (you)</span>}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                  m.role === 'gm' ? 'bg-amber-700 text-white' : 'bg-black/5 dark:bg-white/10'
                }`}
              >
                {m.role === 'gm' ? 'GM' : 'Player'}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Your name and colour, and leaving the session. */
export function YouPanel() {
  const { me, members, uid, updateMe, leave, isGm } = useSession()
  const [name, setName] = useState(me.display_name)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [busy, setBusy] = useState(false)

  const takenBy: Partial<Record<PlayerColor, string>> = {}
  for (const m of members) if (m.user_id !== uid) takenBy[m.color] ??= m.display_name

  async function run(fn: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">You</h2>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = name.trim()
          if (!trimmed || trimmed === me.display_name) return
          void run(async () => {
            await updateMe({ display_name: trimmed })
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
          })
        }}
      >
        <TextField
          className="flex-1"
          label="Display name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={!name.trim() || name.trim() === me.display_name}>
          {saved ? 'Saved' : 'Save'}
        </Button>
      </form>
      <div className="mt-4">
        <ColorPicker value={me.color} takenBy={takenBy} onChange={(color) => void run(() => updateMe({ color }))} />
      </div>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      <div className="mt-5 border-t border-[color:var(--border)] pt-4">
        {!confirmLeave ? (
          <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => setConfirmLeave(true)}>
            Leave session
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {isGm
                ? 'This device stops being GM. You can come back any time with your GM code.'
                : 'You’ll leave this session. Your character stays; the GM can give it back if you rejoin.'}
            </p>
            <div className="flex gap-2">
              <Button variant="danger" busy={busy} onClick={() => void run(leave)}>Leave</Button>
              <Button variant="secondary" onClick={() => setConfirmLeave(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
