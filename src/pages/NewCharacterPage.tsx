import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { buildTemplate, TEMPLATES } from '../sheet/templates.ts'
import type { TemplateId } from '../sheet/types.ts'
import { Button, Notice, TextField } from '../ui/primitives.tsx'
import { SessionHeader } from './SessionHeader.tsx'

/** /s/:id/new-character — pick a template and a name (SPEC §5.5). */
export default function NewCharacterPage() {
  const { session, isGm, refresh } = useSession()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<TemplateId>('core')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isGm) return <Navigate to={`/s/${session.id}/gm`} replace />

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const sheet = buildTemplate(template, name.trim() || 'Unnamed')
      const { data, error } = await supabase.rpc('create_character', { p_session_id: session.id, p_sheet: sheet })
      if (error) throw error
      await refresh()
      navigate(`/s/${session.id}/c/${data}`, { replace: true })
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <>
      <SessionHeader tabs />
      <main className="mx-auto max-w-screen-sm px-4 py-6">
        <h1 className="text-2xl font-bold">Create your character</h1>
        <form className="mt-5 flex flex-col gap-5" onSubmit={create}>
          <TextField
            label="Character name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Sir Aldric"
            autoFocus
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Start from</legend>
            {TEMPLATES.map((t) => (
              <label
                key={t.id}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 bg-[color:var(--card)] px-4 py-3 ${
                  template === t.id ? 'border-amber-600' : 'border-[color:var(--border)]'
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                  className="size-5 accent-amber-700"
                />
                <span>
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block text-sm text-[color:var(--muted)]">{t.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" busy={busy}>Create character</Button>
        </form>
      </main>
    </>
  )
}
