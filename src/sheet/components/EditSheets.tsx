import { useRef, useState } from 'react'
import { positionBetween } from '../../lib/positions.ts'
import { BottomSheet } from '../../ui/BottomSheet.tsx'
import { Button, Notice } from '../../ui/primitives.tsx'
import { BLOCK_TYPE_INFO, defaultBlock } from '../defaults.ts'
import { newBlockId, newSectionId } from '../ids.ts'
import { exportFileName, exportSheet, parseImport, sheetToRows } from '../io.ts'
import type { SheetData, SheetOpBody } from '../ops.ts'
import { buildTemplate, TEMPLATES } from '../templates.ts'
import { BLOCK_TYPES, type SectionRow, type SheetJson, type TemplateId } from '../types.ts'

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

type Pending = { kind: 'template'; template: TemplateId } | { kind: 'import'; sheet: SheetJson; notes: string[] }

/** Sheet-wide tools: export / import JSON, apply a template. Both replacements ask first. */
export function SheetToolsSheet({ data, send, onClose }: { data: SheetData; send: (op: SheetOpBody) => void; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
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
    setPending({ kind: 'import', sheet: res.sheet, notes: res.notes })
  }

  const confirm = () => {
    if (!pending) return
    const sheet: SheetJson = pending.kind === 'import'
      ? pending.sheet
      : { ...buildTemplate(pending.template, c.name), fate_points: c.fate_points }
    send({ kind: 'replace', sheet, preview: sheetToRows(sheet, c.id) })
    onClose()
  }

  return (
    <BottomSheet open title="Sheet tools" onDismiss={onClose}>
      {!pending ? (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Export / import</h3>
            <p className="text-sm text-[color:var(--muted)]">Save this sheet as a .fate.json file, or load one (replaces this sheet).</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={download}>Export JSON</Button>
              <Button variant="secondary" onClick={() => file.current?.click()}>Import JSON…</Button>
              <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
            </div>
            {error && <Notice tone="error">{error}</Notice>}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Start over from a template</h3>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <Button key={t.id} variant="secondary" onClick={() => setPending({ kind: 'template', template: t.id })}>{t.name}</Button>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {pending.kind === 'import' ? (
            <>
              <p>
                Replace <strong>{c.name}</strong> with <strong>{pending.sheet.name}</strong>: {pending.sheet.sections.length} sections,{' '}
                {pending.sheet.blocks.length} blocks, {pending.sheet.fate_points} fate points, refresh {pending.sheet.refresh}.
              </p>
              {pending.notes.length > 0 && (
                <Notice>
                  <ul className="list-disc pl-4">{pending.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </Notice>
              )}
            </>
          ) : (
            <p>
              Replace everything on <strong>{c.name}</strong> with a blank{' '}
              <strong>{TEMPLATES.find((t) => t.id === pending.template)?.name}</strong> sheet? Fate points stay at {c.fate_points}.
            </p>
          )}
          <Notice tone="error">This replaces every section and block on the sheet. Export first if you might want it back.</Notice>
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" onClick={confirm}>Replace sheet</Button>
            <Button variant="secondary" onClick={() => setPending(null)}>Back</Button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
