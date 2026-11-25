import { useState, type FormEvent } from 'react'
import { friendlyError } from '../lib/errors.ts'
import { GM_CODE_PROBLEM_TEXT, gmCodeProblem, normalizeGmCode, suggestGmCode } from '../lib/gmCode.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { InvitePanel, YouPanel } from '../session/SessionWidgets.tsx'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { colorOf } from '../ui/colors.ts'
import { Button, Card, Notice, TextField } from '../ui/primitives.tsx'
import { toast } from '../ui/toast.tsx'

/** Members panel (SPEC §8.1): invite, members (kick), assign characters, change GM code. */
export function MembersSheet({ onClose }: { onClose: () => void }) {
  return (
    <BottomSheet open title="Members" onDismiss={onClose}>
      <div className="flex flex-col gap-4">
        <InvitePanel />
        <MembersWithKick />
        <AssignCharacters />
        <ChangeGmCode />
        <YouPanel />
      </div>
    </BottomSheet>
  )
}

function MembersWithKick() {
  const { members, uid, session, characters } = useSession()
  const [confirm, setConfirm] = useState<string | null>(null)
  const kick = async (userId: string) => {
    const { error } = await supabase.from('session_members').delete().eq('session_id', session.id).eq('user_id', userId)
    setConfirm(null)
    if (error) toast(friendlyError(error), 'error')
  }
  return (
    <Card>
      <h3 className="text-lg font-semibold">At the table</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {members.map((m) => {
          const c = colorOf(m.color)
          const pcs = characters.filter((x) => x.kind === 'pc' && x.owner_id === m.user_id).map((x) => x.name)
          return (
            <li key={m.user_id} className="flex min-h-12 flex-wrap items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: c.fill, color: c.ink }} aria-hidden="true">
                {m.display_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.display_name}{m.user_id === uid && ' (you)'}</span>
                <span className="block truncate text-sm text-[color:var(--muted)]">{m.role === 'gm' ? 'GM' : pcs.join(', ') || 'No character yet'}</span>
              </span>
              {m.user_id !== uid && (confirm === m.user_id ? (
                <span className="flex gap-1">
                  <Button variant="danger" onClick={() => void kick(m.user_id)}>Remove</Button>
                  <Button variant="secondary" onClick={() => setConfirm(null)}>Keep</Button>
                </span>
              ) : (
                <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => setConfirm(m.user_id)}>Remove…</Button>
              ))}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-[color:var(--muted)]">Removed players can rejoin with the invite link. Their character stays and can be given back below.</p>
    </Card>
  )
}

function AssignCharacters() {
  const { characters, members } = useSession()
  const pcs = characters.filter((c) => c.kind === 'pc')
  const players = members.filter((m) => m.role === 'player')
  if (!pcs.length) return null
  const assign = async (characterId: string, userId: string) => {
    const { error } = await supabase.rpc('assign_character', { p_character_id: characterId, p_user_id: userId || null })
    if (error) toast(friendlyError(error), 'error')
    else toast('Character reassigned.')
  }
  return (
    <Card>
      <h3 className="text-lg font-semibold">Who plays which character</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {pcs.map((c) => {
          const orphan = !members.some((m) => m.user_id === c.owner_id)
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 truncate font-medium">
                {c.name}
                {orphan && <span className="ml-2 rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">Orphaned</span>}
              </span>
              <select
                aria-label={`Player for ${c.name}`}
                value={orphan ? '' : c.owner_id ?? ''}
                onChange={(e) => void assign(c.id, e.target.value)}
                className="min-h-11 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-2"
              >
                <option value="">No player</option>
                {players.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
              </select>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function ChangeGmCode() {
  const { session } = useSession()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const problem = gmCodeProblem(a)
    if (problem) return setError(GM_CODE_PROBLEM_TEXT[problem])
    if (normalizeGmCode(a) !== normalizeGmCode(b)) return setError('The two codes don’t match.')
    setBusy(true)
    const { error: err } = await supabase.rpc('change_gm_code', { p_session_id: session.id, p_new_code: a })
    setBusy(false)
    if (err) return setError(friendlyError(err))
    setA(''); setB('')
    toast('GM code changed. The old code no longer works.')
  }
  return (
    <Card>
      <h3 className="text-lg font-semibold">Change GM code</h3>
      <form className="mt-2 flex flex-col gap-3" onSubmit={submit}>
        <TextField label="New GM code" value={a} onChange={(e) => setA(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <TextField label="Type it again" value={b} onChange={(e) => setB(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy} disabled={!a || !b}>Change code</Button>
          <Button variant="secondary" onClick={() => { const s = suggestGmCode(); setA(s); setB(s) }}>Suggest one</Button>
        </div>
        <p className="text-xs text-[color:var(--muted)]">Devices already signed in as GM stay GM.</p>
      </form>
    </Card>
  )
}
