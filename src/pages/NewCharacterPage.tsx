import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { TemplatePicker } from '../sheet/components/TemplatePicker.tsx'
import { sheetFromChoice, templateChoices } from '../sheet/templateSources.ts'
import { Button, Notice, TextField } from '../ui/primitives.tsx'
import { SessionHeader } from './SessionHeader.tsx'

/** /s/:id/new-character — pick a template and a name (SPEC §5.5). */
export default function NewCharacterPage() {
  const { session, isGm, refresh, characters } = useSession()
  const choices = templateChoices(characters, false)
  const all = [...choices.gm, ...choices.builtin]
  const navigate = useNavigate()
  const [name, setName] = useState('')
  // The GM's own template is the natural default when there is one.
  const [templateKey, setTemplateKey] = useState(() => all[0]?.key ?? 'b:core')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isGm) return <Navigate to={`/s/${session.id}/gm`} replace />

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const choice = all.find((c) => c.key === templateKey) ?? all[0]
      const sheet = await sheetFromChoice(choice, name.trim() || 'Unnamed')
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
      <main id="main" tabIndex={-1} className="mx-auto max-w-screen-sm px-4 py-6">
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
          <div>
            <p className="mb-2 text-sm font-medium">Start from</p>
            <TemplatePicker gm={choices.gm} builtin={choices.builtin} value={templateKey} onChange={setTemplateKey} />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" busy={busy}>Create character</Button>
        </form>
      </main>
    </>
  )
}
