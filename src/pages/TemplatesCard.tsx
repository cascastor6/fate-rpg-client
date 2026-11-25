import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { TemplatePicker } from '../sheet/components/TemplatePicker.tsx'
import { parseTemplatesFile, withFreshIds } from '../sheet/io.ts'
import { sheetFromChoice, templateChoices } from '../sheet/templateSources.ts'
import type { SheetJson } from '../sheet/types.ts'
import { toast } from '../ui/toast.tsx'
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
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setCreating(true)}>New template</Button>
        <ImportTemplates />
      </div>
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

/** Import a template bundle (from "Delete session") or a single sheet as template(s). */
function ImportTemplates() {
  const { session, refresh } = useSession()
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ templates: { sheet: SheetJson; offered: boolean }[]; notes: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (f: File | undefined) => {
    setError(null)
    if (!f) return
    if (f.size > 5_000_000) return setError('That file is too big.')
    const res = parseTemplatesFile(await f.text())
    if (!res.ok) return setError(res.error)
    setPending({ templates: res.templates, notes: res.notes })
  }

  const run = async () => {
    if (!pending) return
    setBusy(true)
    let done = 0
    try {
      for (const t of pending.templates) {
        const { data: id, error: err } = await supabase.rpc('create_character', {
          p_session_id: session.id, p_sheet: withFreshIds({ ...t.sheet, kind: 'template' }),
        })
        if (err) throw err
        if (t.offered) {
          const { error: e2 } = await supabase.from('characters').update({ visible_to_players: true }).eq('id', id as string)
          if (e2) throw e2
        }
        done++
      }
      toast(`Imported ${done} template${done === 1 ? '' : 's'}.`)
      setPending(null)
    } catch (e) {
      toast(`${friendlyError(e)} (${done} of ${pending.templates.length} imported)`, 'error')
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => file.current?.click()}>Import templates…</Button>
      <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="Templates file"
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
      {error && <div className="w-full"><Notice tone="error">{error}</Notice></div>}
      {pending && (
        <BottomSheet open title="Import templates" onDismiss={() => setPending(null)}>
          <div className="flex flex-col gap-3">
            <p>Add {pending.templates.length} template{pending.templates.length === 1 ? '' : 's'} to this session:</p>
            <ul className="list-disc pl-5">
              {pending.templates.map((t, i) => (
                <li key={i}>{t.sheet.name} <span className="text-sm text-[color:var(--muted)]">({t.sheet.blocks.length} blocks{t.offered ? ', offered to players' : ', draft'})</span></li>
              ))}
            </ul>
            {pending.notes.length > 0 && <Notice><ul className="list-disc pl-4">{pending.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Notice>}
            <div className="flex gap-2">
              <Button className="flex-1" busy={busy} onClick={() => void run()}>Import</Button>
              <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        </BottomSheet>
      )}
    </>
  )
}
