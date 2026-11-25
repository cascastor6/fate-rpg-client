import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { signed } from '../dice/ladder.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { SheetView } from '../sheet/components/SheetView.tsx'
import type { SheetOpBody } from '../sheet/ops.ts'
import type { BlockRow, CharacterRow } from '../sheet/types.ts'
import { useSheet } from '../sheet/useSheet.ts'
import { BottomSheet } from '../ui/BottomSheet.tsx'
import { colorOf } from '../ui/colors.ts'
import { IconDie, IconMenu, IconMinus, IconPencil, IconPlus } from '../ui/icons.tsx'
import { Button, FullScreenSpinner, Notice } from '../ui/primitives.tsx'
import { toast } from '../ui/toast.tsx'
import { BottomBar } from './BottomBar.tsx'
import { SessionHeader } from './SessionHeader.tsx'
import { SessionMenu } from './SessionMenu.tsx'

/** /s/:id/c/:characterId — a character sheet in play mode (editable or read-only). */
export default function SheetPage() {
  const { characterId = '' } = useParams()
  const { uid, isGm, session, members } = useSession()
  const { snapshot, enqueue } = useSheet(characterId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

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
  const owner = members.find((m) => m.user_id === c.owner_id)
  const ownerColor = colorOf(owner?.color)

  const subtitle = own ? undefined : c.kind === 'npc' ? 'NPC' : owner ? `Played by ${owner.display_name}` : 'No player (orphaned)'

  const onRoll = (b: BlockRow) =>
    toast(`Rolling ${b.label || 'that skill'} (${signed(typeof b.value === 'number' ? b.value : 0)}) arrives with the dice in Slice 6.`)

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

        {c.kind === 'pc' && (
          <div className="flex items-center gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] px-4 py-2 text-sm">
            <span>
              Fate Points <strong className="text-lg tabular-nums">{c.fate_points}</strong>
            </span>
            <span className="text-[color:var(--muted)]">·</span>
            <span>
              Refresh <strong className="text-lg tabular-nums">{c.refresh}</strong>
            </span>
          </div>
        )}

        {!canEdit && <Notice>You’re viewing {owner ? `${owner.display_name}’s` : 'this'} character. It’s read-only for you.</Notice>}

        <SheetView data={data} canEdit={canEdit} canRoll={canEdit} send={enqueue} onRoll={onRoll} />

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
        {canEdit && (
          <Button className="flex-1" onClick={() => toast('Rolling arrives with the dice in Slice 6.')}>
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
