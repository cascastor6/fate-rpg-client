import { useEffect, useState } from 'react'
import { useDice } from '../dice/useDice.ts'
import { useSpotlight } from '../gm/spotlight.ts'
import { overlays } from '../ui/overlays.ts'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { friendlyError } from '../lib/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { EditSheet } from '../sheet/components/EditSheet.tsx'
import { SheetToolsSheet, TemplatesSheet } from '../sheet/components/EditSheets.tsx'
import { SheetView } from '../sheet/components/SheetView.tsx'
import type { SheetOpBody } from '../sheet/ops.ts'
import type { BlockRow, CharacterRow } from '../sheet/types.ts'
import { getSheetStore } from '../sheet/store.ts'
import { useSheet } from '../sheet/useSheet.ts'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { colorOf } from '../ui/colors.ts'
import { IconDie, IconMenu, IconMinus, IconPencil, IconPlus } from '../ui/icons.tsx'
import { Button, FullScreenSpinner, Notice } from '../ui/primitives.tsx'
import { Stepper } from '../ui/Stepper.tsx'
import { toast } from '../ui/toast.tsx'
import { BottomBar } from './BottomBar.tsx'
import { SessionHeader } from './SessionHeader.tsx'
import { SessionMenu } from './SessionMenu.tsx'

/** /s/:id/c/:characterId — remount per character so edit mode etc. don't carry over. */
export default function SheetPageRoute() {
  const { characterId = '' } = useParams()
  return <SheetPage key={characterId} characterId={characterId} />
}

/** A character sheet in play mode (editable or read-only), or edit mode. */
function SheetPage({ characterId }: { characterId: string }) {
  const { uid, isGm, session, members, refresh } = useSession()
  const navigate = useNavigate()
  const { snapshot, enqueue } = useSheet(characterId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const dice = useDice()
  const spotlight = useSpotlight()
  // The floating roll button hides while the layout is being edited.
  useEffect(() => {
    overlays.setBusy(editMode)
    return () => overlays.setBusy(false)
  }, [editMode])
  const [tools, setTools] = useState(false)
  const [templates, setTemplates] = useState(false)

  if (snapshot.status === 'loading') return <FullScreenSpinner label="Loading sheet…" />
  if (snapshot.status !== 'ready') {
    return (
      <>
        <SessionHeader tabs back={isGm ? `/s/${session.id}/gm` : `/s/${session.id}/table`} />
        <main className="mx-auto max-w-screen-sm px-4 py-6">
          <Notice tone="error">
            {snapshot.status === 'missing' ? 'This character doesn’t exist, or you can’t see it.' : snapshot.message}
          </Notice>
        </main>
      </>
    )
  }

  const { data, pending, offline } = snapshot
  const c = data.character
  const own = c.kind === 'pc' && c.owner_id === uid
  const canEdit = isGm || own
  const editing = editMode && canEdit
  const owner = members.find((m) => m.user_id === c.owner_id)
  const ownerColor = colorOf(owner?.color)

  const isTemplate = c.kind === 'template'
  const subtitle = own
    ? undefined
    : isTemplate
      ? `Template · ${c.visible_to_players ? 'offered to players' : 'draft, only you can see it'}`
      : c.kind === 'npc' ? 'NPC' : owner ? `Played by ${owner.display_name}` : 'No player (orphaned)'

  const setOffered = async (offered: boolean) => {
    const { error } = await supabase.from('characters').update({ visible_to_players: offered }).eq('id', c.id)
    if (error) return toast(friendlyError(error), 'error')
    await refresh()
    void getSheetStore(c.id).load()
    toast(offered ? 'Players can now start from this template.' : 'Template hidden from players.')
  }
  const deleteTemplate = async () => {
    if (!window.confirm(`Delete the template “${c.name}”? Characters made from it are not affected.`)) return
    const { error } = await supabase.from('characters').delete().eq('id', c.id)
    if (error) return toast(friendlyError(error), 'error')
    await refresh()
    navigate(`/s/${session.id}/gm`, { replace: true })
  }

  // Press a skill to roll it (SPEC §6.1); ignored while one of our rolls is in flight.
  const onRoll = (b: BlockRow) => void dice.store.roll({ characterId: c.id, blockId: b.id })

  return (
    <>
      <SessionHeader tabs={!isGm} subtitle={isGm ? 'GM view' : undefined} back={isGm ? `/s/${session.id}/gm` : '/'} />
      <main className="mx-auto flex max-w-screen-sm flex-col gap-3 px-3 pt-4 pb-28">
        <div className="flex items-start gap-3 px-1">
          <span className="mt-1.5 size-4 shrink-0 rounded-full" style={{ background: ownerColor.fill }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {canEdit ? (
              <button type="button" className="group flex min-h-11 max-w-full items-center gap-2 text-left" onClick={() => setRenaming(true)}>
                <h1 className="truncate text-2xl font-bold">{c.name}</h1>
                <IconPencil className="size-4 shrink-0 text-[color:var(--muted)] opacity-60 group-hover:opacity-100" />
              </button>
            ) : (
              <h1 className="min-h-11 truncate text-2xl font-bold leading-[2.75rem]">{c.name}</h1>
            )}
            {subtitle && <p className="text-sm text-[color:var(--muted)]">{subtitle}</p>}
          </div>
          <SaveState pending={pending} offline={offline} />
        </div>

        {isTemplate && isGm && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] px-4 py-3">
            <p className="flex-1 text-sm">
              {c.visible_to_players
                ? 'Players see this template when they create a character or pick a template while editing.'
                : 'Build the layout with Edit layout, then offer it to players.'}
            </p>
            <Button variant={c.visible_to_players ? 'secondary' : 'primary'} onClick={() => void setOffered(!c.visible_to_players)}>
              {c.visible_to_players ? 'Stop offering' : 'Offer to players'}
            </Button>
            <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => void deleteTemplate()}>Delete template</Button>
          </div>
        )}

        {(c.kind === 'pc' || isTemplate) && (
          <div className="flex items-center gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] px-4 py-2 text-sm">
            {isTemplate && editing ? (
              <span className="flex items-center gap-2 whitespace-nowrap">
                Starting FP
                <Stepper label="starting fate points" value={c.fate_points} min={0} onStep={(d) => enqueue({ kind: 'fate', delta: d })} />
              </span>
            ) : (
              <span className="whitespace-nowrap">
                {isTemplate ? 'Starts with ' : ''}Fate Points <strong className="text-lg tabular-nums">{c.fate_points}</strong>
              </span>
            )}
            <span className="text-[color:var(--muted)]">·</span>
            {editing ? (
              <span className="ml-auto flex items-center gap-2">
                Refresh
                <Stepper label="refresh" value={c.refresh} min={0} onStep={(d) => enqueue({ kind: 'character', patch: { refresh: Math.max(0, c.refresh + d) } })} />
              </span>
            ) : (
              <span>
                Refresh <strong className="text-lg tabular-nums">{c.refresh}</strong>
              </span>
            )}
          </div>
        )}

        {canEdit && (
          editing ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-amber-600 bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
              <span className="flex-1 text-sm font-semibold">Editing layout: drag the dots to move, gear for settings</span>
              <Button variant="secondary" onClick={() => setTemplates(true)}>Templates</Button>
              <Button variant="secondary" onClick={() => setTools(true)}>Sheet tools</Button>
              <Button onClick={() => setEditMode(false)}>Done</Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="ghost" className="text-sm" onClick={() => setEditMode(true)}>
                <IconPencil className="size-4" /> Edit layout
              </Button>
            </div>
          )
        )}

        {!canEdit && !isTemplate && <Notice>You’re viewing {owner ? `${owner.display_name}’s` : 'this'} character. It’s read-only for you.</Notice>}

        {editing ? (
          <EditSheet data={data} send={enqueue} />
        ) : (
          <SheetView
            data={data}
            canEdit={canEdit}
            canRoll={canEdit && !isTemplate}
            send={enqueue}
            onRoll={onRoll}
            spot={isGm && !isTemplate ? {
              isLit: (b) => spotlight.isBlockLit(c.id, b.id),
              toggle: (b) => void spotlight.toggleBlock(c.id, b.id),
              color: colorOf(members.find((m) => m.user_id === uid)?.color).fill,
            } : undefined}
          />
        )}

        {!canEdit && (
          <Link to={`/s/${session.id}/table`} className="self-start px-1 text-sm underline underline-offset-4">
            ← Back to the table
          </Link>
        )}
      </main>

      <BottomBar>
        {canEdit && c.kind === 'pc' ? (
          <FatePoints value={c.fate_points} send={enqueue} />
        ) : (
          <div className="flex-1" />
        )}
        {editing ? (
          <Button className="flex-1" onClick={() => setEditMode(false)}>Done editing</Button>
        ) : isTemplate ? (
          canEdit && <Button className="flex-1" onClick={() => setEditMode(true)}><IconPencil className="size-4" /> Edit layout</Button>
        ) : canEdit && (
          <Button className="flex-1" onClick={() => dice.store.openDialog(c.id)}>
            <IconDie /> Roll
          </Button>
        )}
        <button
          type="button"
          className="flex size-12 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
        >
          <IconMenu className="size-6" />
        </button>
      </BottomBar>

      <SessionMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      {templates && <TemplatesSheet data={data} send={enqueue} onClose={() => setTemplates(false)} />}
      {tools && <SheetToolsSheet data={data} send={enqueue} onClose={() => setTools(false)} />}
      {renaming && <RenameSheet character={c} send={enqueue} onClose={() => setRenaming(false)} />}
    </>
  )
}

function FatePoints({ value, send }: { value: number; send: (op: SheetOpBody) => void }) {
  return (
    <div className="flex items-center" role="group" aria-label="Fate points">
      <button
        type="button"
        className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)] disabled:opacity-30"
        onClick={() => send({ kind: 'fate', delta: -1 })}
        disabled={value <= 0}
        aria-label="Spend a fate point"
      >
        <IconMinus />
      </button>
      <span className="flex min-w-14 flex-col items-center leading-none">
        <span className="text-xl font-bold tabular-nums" aria-live="polite">{value}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">Fate</span>
      </span>
      <button
        type="button"
        className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)]"
        onClick={() => send({ kind: 'fate', delta: 1 })}
        aria-label="Gain a fate point"
      >
        <IconPlus />
      </button>
    </div>
  )
}

function SaveState({ pending, offline }: { pending: number; offline: boolean }) {
  if (offline) {
    return <span className="mt-3 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900 dark:bg-red-950 dark:text-red-200">Offline · {pending} waiting</span>
  }
  if (pending) return <span className="mt-3 shrink-0 text-xs text-[color:var(--muted)]">Saving…</span>
  return null
}

function RenameSheet({ character, send, onClose }: { character: CharacterRow; send: (op: SheetOpBody) => void; onClose: () => void }) {
  const [name, setName] = useState(character.name)
  const save = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== character.name) send({ kind: 'character', patch: { name: trimmed } })
    onClose()
  }
  return (
    <BottomSheet open title="Character name" onDismiss={save}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          aria-label="Character name"
          className="min-h-12 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-lg"
        />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">Done</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </BottomSheet>
  )
}
