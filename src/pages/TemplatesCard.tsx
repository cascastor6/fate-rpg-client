import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { TemplatePicker } from '../sheet/components/TemplatePicker.tsx'
import { sheetFromChoice, templateChoices } from '../sheet/templateSources.ts'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { Button, Card, Notice, TextField } from '../ui/primitives.tsx'

/** GM screen: the session's own templates (SPEC §5.7). */
export function TemplatesCard() {
  const { characters, session } = useSession()
  const [creating, setCreating] = useState(false)
  const templates = characters.filter((c) => c.kind === 'template')
  return (
    <Card>
      <h2 className="text-lg font-semibold">Templates</h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Starting sheets for your game. Players see the ones you offer when they create a character.
      </p>
      {templates.length > 0 && (
        <ul className="mt-3 flex flex-col">
          {templates.map((t) => (
            <li key={t.id}>
              <Link to={`/s/${session.id}/c/${t.id}`} className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-black/5 dark:hover:bg-white/5">
                <span className="flex-1 truncate font-medium">{t.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    t.visible_to_players ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200' : 'bg-black/5 dark:bg-white/10'
                  }`}
                >
                  {t.visible_to_players ? 'Offered' : 'Draft'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" className="mt-3" onClick={() => setCreating(true)}>New template</Button>
      {creating && <NewTemplateSheet onClose={() => setCreating(false)} />}
    </Card>
  )
}

function NewTemplateSheet({ onClose }: { onClose: () => void }) {
  const { characters, session, refresh } = useSession()
  const navigate = useNavigate()
  const choices = templateChoices(characters, true)
  const [name, setName] = useState('')
  const [key, setKey] = useState('b:core')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const choice = [...choices.gm, ...choices.builtin].find((c) => c.key === key)!
      const sheet = { ...(await sheetFromChoice(choice, name.trim() || 'New template')), kind: 'template' as const }
      const { data, error } = await supabase.rpc('create_character', { p_session_id: session.id, p_sheet: sheet })
      if (error) throw error
      await refresh()
      navigate(`/s/${session.id}/c/${data}`)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <BottomSheet open title="New template" onDismiss={onClose}>
      <form className="flex flex-col gap-4" onSubmit={create}>
        <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Knight of the Silver Order" />
        <div>
          <p className="mb-2 text-sm font-medium">Based on</p>
          <TemplatePicker gm={choices.gm} builtin={choices.builtin} value={key} onChange={setKey} />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" busy={busy} disabled={!name.trim()}>Create and edit</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </BottomSheet>
  )
}
