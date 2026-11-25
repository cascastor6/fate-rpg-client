import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyError } from '../../lib/errors.ts'
import { supabase } from '../../lib/supabase.ts'
import { useSession } from '../../session/SessionProvider.tsx'
import { positionBetween } from '../../lib/positions.ts'
import { BottomSheet } from '../../ui/BottomSheet.tsx'
import { Button, Notice } from '../../ui/primitives.tsx'
import { BLOCK_TYPE_INFO, defaultBlock } from '../defaults.ts'
import { newBlockId, newSectionId } from '../ids.ts'
import { exportFileName, exportSheet, mergeSheet, parseImport, sheetToRows, withFreshIds } from '../io.ts'
import type { SheetData, SheetOpBody } from '../ops.ts'
import { sheetFromChoice, templateChoices } from '../templateSources.ts'
import { BLOCK_TYPES, type SectionRow, type SheetJson } from '../types.ts'
import { TemplatePicker } from './TemplatePicker.tsx'

const input = 'min-h-12 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-base'

/** Pick a block type; it's added at the end of the section and its settings open. */
export function AddBlockSheet({
  data, sectionId, send, onClose, onAdded,
}: {
  data: SheetData
  sectionId: string
  send: (op: SheetOpBody) => void
  onClose: () => void
  onAdded: (id: string) => void
}) {
  const section = data.sections.find((s) => s.id === sectionId)
  const last = data.blocks.filter((b) => b.section_id === sectionId).at(-1)
  const tooMany = data.blocks.length >= 300
  return (
    <BottomSheet open title={`Add to ${section?.title ?? 'section'}`} onDismiss={onClose}>
      {tooMany && <div className="mb-3"><Notice tone="error">This sheet has the maximum of 300 blocks.</Notice></div>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {BLOCK_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            disabled={tooMany}
            className="flex min-h-14 flex-col items-start justify-center rounded-xl border border-[color:var(--border)] px-4 py-2 text-left hover:border-amber-600 disabled:opacity-40"
            onClick={() => {
              const id = newBlockId()
              const d = defaultBlock(t)
              send({
                kind: 'insert_block',
                block: { character_id: data.character.id, id, section_id: sectionId, type: t, ...d, position: positionBetween(last?.position, null), version: 0 },
              })
              onAdded(id)
            }}
          >
            <span className="font-semibold">{BLOCK_TYPE_INFO[t].name}</span>
            <span className="text-sm text-[color:var(--muted)]">{BLOCK_TYPE_INFO[t].blurb}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}

/** Add a section, or rename / delete an existing one. */
export function SectionSheet({
  data, section, send, onClose,
}: {
  data: SheetData
  section: SectionRow | null
  send: (op: SheetOpBody) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(section?.title ?? '')
  const [confirm, setConfirm] = useState(false)
  const count = section ? data.blocks.filter((b) => b.section_id === section.id).length : 0

  const save = () => {
    const t = title.trim().slice(0, 60)
    if (!t) return onClose()
    if (!section) {
      const last = data.sections.at(-1)
      send({ kind: 'insert_section', section: { character_id: data.character.id, id: newSectionId(), title: t, position: positionBetween(last?.position, null), version: 0 } })
    } else if (t !== section.title) {
      send({ kind: 'patch_section', sectionId: section.id, patch: { title: t } })
    }
    onClose()
  }

  return (
    <BottomSheet open title={section ? 'Section' : 'New section'} onDismiss={save}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Title</span>
          <input className={input} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Gear" data-autofocus />
        </label>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={!title.trim()}>{section ? 'Done' : 'Add section'}</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
        {section && (
          !confirm ? (
            <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => (count ? setConfirm(true) : (send({ kind: 'delete_section', sectionId: section.id, withBlocks: false }), onClose()))}>
              Delete section
            </Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-red-300 p-3 dark:border-red-800">
              <p className="text-sm">“{section.title}” has {count} block{count === 1 ? '' : 's'}. Delete them too? This can’t be undone.</p>
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => { send({ kind: 'delete_section', sectionId: section.id, withBlocks: true }); onClose() }}>
                  Delete section and {count} block{count === 1 ? '' : 's'}
                </Button>
                <Button variant="secondary" onClick={() => setConfirm(false)}>Keep</Button>
              </div>
            </div>
          )
        )}
      </form>
    </BottomSheet>
  )
}

type PendingImport = { sheet: SheetJson; notes: string[] }

/** Sheet-wide tools: export / import JSON, and (GM) save a copy as a template. */
export function SheetToolsSheet({ data, send, onClose }: { data: SheetData; send: (op: SheetOpBody) => void; onClose: () => void }) {
  const { isGm, session, refresh } = useSession()
  const navigate = useNavigate()
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const c = data.character

  const download = () => {
    const blob = new Blob([JSON.stringify(exportSheet(data), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName(c.name)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onFile = async (f: File | undefined) => {
    setError(null)
    if (!f) return
    if (f.size > 1_000_000) return setError('That file is too big to be a character sheet.')
    const res = parseImport(await f.text())
    if (!res.ok) return setError(res.error)
    setPending({ sheet: res.sheet, notes: res.notes })
  }

  const saveAsTemplate = async () => {
    setBusy(true)
    setError(null)
    try {
      const sheet = withFreshIds({ ...exportSheet(data), kind: 'template', name: `${c.name} (template)` })
      const { data: id, error } = await supabase.rpc('create_character', { p_session_id: session.id, p_sheet: sheet })
      if (error) throw error
      await refresh()
      onClose()
      navigate(`/s/${session.id}/c/${id}`)
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  if (pending) {
    // Imports keep the kind of the sheet they land on (a PC stays a PC).
    const sheet = { ...pending.sheet, kind: c.kind }
    return (
      <BottomSheet open title="Import sheet" onDismiss={onClose}>
        <div className="flex flex-col gap-4">
          <p>
            Replace <strong>{c.name}</strong> with <strong>{sheet.name}</strong>: {sheet.sections.length} sections,{' '}
            {sheet.blocks.length} blocks, {sheet.fate_points} fate points, refresh {sheet.refresh}.
          </p>
          {pending.notes.length > 0 && (
            <Notice>
              <ul className="list-disc pl-4">{pending.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </Notice>
          )}
          <Notice tone="error">This replaces every section and block on the sheet. Export first if you might want it back.</Notice>
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" onClick={() => { send({ kind: 'replace', sheet, preview: sheetToRows(sheet, c.id) }); onClose() }}>
              Replace sheet
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>Back</Button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet open title="Sheet tools" onDismiss={onClose}>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Export / import</h3>
          <p className="text-sm text-[color:var(--muted)]">Save this sheet as a .fate.json file, or load one (replaces this sheet).</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={download}>Export JSON</Button>
            <Button variant="secondary" onClick={() => file.current?.click()}>Import JSON…</Button>
            <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </section>
        {isGm && c.kind !== 'template' && (
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Make a template</h3>
            <p className="text-sm text-[color:var(--muted)]">Copy this sheet’s layout into a new template players can start from. You can tidy it before offering it.</p>
            <Button variant="secondary" busy={busy} onClick={() => void saveAsTemplate()}>Save a copy as template</Button>
          </section>
        )}
        {c.kind !== 'template' && <DeleteCharacter data={data} onClose={onClose} />}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </BottomSheet>
  )
}

/** Delete a PC or NPC (owner or GM; RLS decides). Templates have their own Delete button. */
function DeleteCharacter({ data, onClose }: { data: SheetData; onClose: () => void }) {
  const { isGm, session, refresh } = useSession()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const c = data.character
  const run = async () => {
    setBusy(true)
    setError(null)
    const { data: rows, error: err } = await supabase.from('characters').delete().eq('id', c.id).select('id')
    if (err || !rows?.length) {
      setError(err ? friendlyError(err) : 'You can’t delete this character.')
      setBusy(false)
      return
    }
    await refresh()
    onClose()
    navigate(isGm ? `/s/${session.id}/gm${c.kind === 'npc' ? '/scenes' : ''}` : `/s/${session.id}/new-character`, { replace: true })
  }
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-red-300 p-3 dark:border-red-900">
      <h3 className="font-semibold text-red-800 dark:text-red-300">Delete {c.kind === 'npc' ? 'NPC' : 'character'}</h3>
      {!confirm ? (
        <Button variant="ghost" className="self-start text-red-700 dark:text-red-400" onClick={() => setConfirm(true)}>Delete {c.name}…</Button>
      ) : (
        <>
          <p className="text-sm">
            Delete <strong>{c.name}</strong> and its whole sheet? Roll history stays, and any board token becomes a plain marker.
            {' '}This can’t be undone; export it first if you might want it back.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex gap-2">
            <Button variant="danger" busy={busy} onClick={() => void run()}>Delete</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Keep</Button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Templates while editing (SPEC §6.2): add a template's sections to this sheet
 * (merged by section title) or replace the sheet with it. Includes GM-made templates.
 */
export function TemplatesSheet({ data, send, onClose }: { data: SheetData; send: (op: SheetOpBody) => void; onClose: () => void }) {
  const { characters, isGm } = useSession()
  const c = data.character
  const choices = templateChoices(characters.filter((x) => x.id !== c.id), isGm)
  const all = [...choices.gm, ...choices.builtin]
  const [key, setKey] = useState(all[0]?.key ?? 'b:core')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [busy, setBusy] = useState<'add' | 'replace' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const choice = all.find((x) => x.key === key) ?? all[0]

  const run = async (mode: 'add' | 'replace') => {
    setBusy(mode)
    setError(null)
    try {
      const fromTemplate = await sheetFromChoice(choice, c.name)
      let sheet: SheetJson
      if (mode === 'add') {
        const merged = mergeSheet(exportSheet(data), fromTemplate)
        if (!merged.ok) throw new Error(merged.error)
        sheet = merged.sheet
      } else {
        // Replacing keeps the name, kind and current fate points.
        sheet = { ...fromTemplate, kind: c.kind, name: c.name, fate_points: c.fate_points }
      }
      send({ kind: 'replace', sheet, preview: sheetToRows(sheet, c.id) })
      onClose()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(null)
    }
  }

  return (
    <BottomSheet open title="Templates" onDismiss={onClose}>
      <div className="flex flex-col gap-4">
        <TemplatePicker gm={choices.gm} builtin={choices.builtin} value={key} onChange={(k) => { setKey(k); setConfirmReplace(false) }} />
        <p className="text-sm text-[color:var(--muted)]">
          <strong>Add</strong> puts the template’s blocks into sections with the same name (or new sections) and keeps everything already here.{' '}
          <strong>Replace</strong> swaps the whole sheet for the template.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        {!confirmReplace ? (
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" busy={busy === 'add'} onClick={() => void run('add')}>Add to this sheet</Button>
            <Button variant="secondary" onClick={() => setConfirmReplace(true)}>Replace sheet…</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-red-300 p-3 dark:border-red-800">
            <p className="text-sm">Replace every section and block on <strong>{c.name}</strong> with <strong>{choice.name}</strong>? Name and fate points stay. This can’t be undone; export first if you might want it back.</p>
            <div className="flex gap-2">
              <Button variant="danger" busy={busy === 'replace'} onClick={() => void run('replace')}>Replace sheet</Button>
              <Button variant="secondary" onClick={() => setConfirmReplace(false)}>Keep</Button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
