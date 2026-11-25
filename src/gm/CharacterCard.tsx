import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { BlockEditor } from '../sheet/components/BlockEditor.tsx'
import { StressBlock, type BlockActions } from '../sheet/components/Blocks.tsx'
import type { BlockRow, CharacterRow } from '../sheet/types.ts'
import { useSheet } from '../sheet/useSheet.ts'
import { colorOf } from '../ui/colors.ts'
import { IconMinus, IconPencil, IconPlus } from '../ui/icons.tsx'
import { CardSkeleton } from '../ui/Skeleton.tsx'
import { useSpotlight } from './spotlight.ts'

/**
 * Compact GM card for one PC (SPEC §8.1): fate points (award/take), aspects, stress,
 * filled consequences; empty ones behind a chip. Tap an aspect or consequence to
 * spotlight it; the pencil edits.
 */
export function CharacterCard({ character }: { character: CharacterRow }) {
  const { members, me } = useSession()
  const { snapshot, enqueue } = useSheet(character.id)
  const spot = useSpotlight()
  const [editing, setEditing] = useState<string | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const owner = members.find((m) => m.user_id === character.owner_id)
  const color = colorOf(owner?.color)
  const gmColor = colorOf(me.color)

  if (snapshot.status === 'loading') return <CardSkeleton />
  if (snapshot.status !== 'ready') {
    return (
      <article className="flex min-h-40 items-center justify-center rounded-2xl border-2 bg-[color:var(--card)]" style={{ borderColor: color.fill }}>
        <span className="text-sm text-[color:var(--muted)]">Can’t load {character.name}</span>
      </article>
    )
  }
  const { data } = snapshot
  const c = data.character
  const val = (b: BlockRow) => (typeof b.value === 'string' ? b.value.trim() : '')
  const aspects = data.blocks.filter((b) => b.type === 'aspect')
  const conseq = data.blocks.filter((b) => b.type === 'consequence')
  const stress = data.blocks.filter((b) => b.type === 'stress')
  const emptyCount = aspects.filter((b) => !val(b)).length + conseq.filter((b) => !val(b)).length

  const actions: BlockActions = { canEdit: true, edit: (b) => setEditing(b.id), roll: () => {}, send: enqueue }

  const row = (b: BlockRow) => {
    const text = val(b)
    const lit = spot.isBlockLit(c.id, b.id)
    return (
      <li key={b.id} className="flex items-stretch gap-1">
        {text ? (
          <button
            type="button"
            onClick={() => void spot.toggleBlock(c.id, b.id)}
            aria-pressed={lit}
            aria-label={`${lit ? 'Clear highlight on' : 'Highlight for everyone:'} ${b.label}: ${text}`}
            className="min-h-11 flex-1 rounded-lg px-2 py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
            style={lit ? { outline: `3px solid ${gmColor.fill}`, outlineOffset: 1, background: `${gmColor.fill}1a` } : undefined}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              {lit && '★ '}{b.label}{b.type === 'consequence' && b.props.shift != null ? ` (${b.props.shift})` : ''}
              {b.props.free_invokes ? ` · ${b.props.free_invokes} free` : ''}
            </span>
            <span className="block font-semibold leading-snug">{text}</span>
          </button>
        ) : (
          <span className="min-h-11 flex-1 px-2 py-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">{b.label}</span>
            <span className="block text-sm italic text-[color:var(--muted)]">empty</span>
          </span>
        )}
        <button type="button" onClick={() => setEditing(b.id)} aria-label={`Edit ${b.label}`}
          className="flex w-10 shrink-0 items-center justify-center rounded-lg text-[color:var(--muted)] hover:bg-black/5 dark:hover:bg-white/10">
          <IconPencil className="size-4" />
        </button>
      </li>
    )
  }

  const editingBlock = editing ? data.blocks.find((b) => b.id === editing) : undefined

  return (
    <article className="flex flex-col rounded-2xl border-2 bg-[color:var(--card)] shadow-sm" style={{ borderColor: color.fill }} aria-label={c.name}>
      <header className="flex items-center gap-2 border-b border-[color:var(--border)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <Link to={`/s/${c.session_id}/c/${c.id}`} className="block truncate text-lg font-bold hover:underline">{c.name}</Link>
          <p className="truncate text-sm">
            {owner && <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: color.fill }} aria-hidden="true" />}
            {owner ? owner.display_name : <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-900">Orphaned</span>}
          </p>
        </div>
        <div className="flex items-center" role="group" aria-label={`${c.name} fate points`}>
          <button type="button" className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)] disabled:opacity-30"
            onClick={() => enqueue({ kind: 'fate', delta: -1 })} disabled={c.fate_points <= 0} aria-label={`Take a fate point from ${c.name}`}>
            <IconMinus />
          </button>
          <span className="flex min-w-11 flex-col items-center leading-none">
            <span className="text-xl font-bold tabular-nums">{c.fate_points}</span>
            <span className="text-[10px] font-semibold uppercase text-[color:var(--muted)]">FP</span>
          </span>
          <button type="button" className="flex size-11 items-center justify-center rounded-full border border-[color:var(--border)]"
            onClick={() => enqueue({ kind: 'fate', delta: 1 })} aria-label={`Award a fate point to ${c.name}`}>
            <IconPlus />
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-2 p-2">
        <ul className="flex flex-col">{aspects.filter((b) => showEmpty || val(b)).map(row)}</ul>
        {stress.map((b) => <div key={b.id} className="-mx-1"><StressBlock block={b} a={actions} /></div>)}
        {(showEmpty ? conseq : conseq.filter(val)).length > 0 && (
          <ul className="flex flex-col border-t border-[color:var(--border)] pt-1">{(showEmpty ? conseq : conseq.filter(val)).map(row)}</ul>
        )}
        <div className="flex items-center gap-2 px-1 pb-1">
          {emptyCount > 0 && (
            <button type="button" onClick={() => setShowEmpty(!showEmpty)}
              className="min-h-9 rounded-full bg-black/5 px-3 text-xs font-semibold dark:bg-white/10" aria-expanded={showEmpty}>
              {showEmpty ? 'Hide empty' : `${emptyCount} empty`}
            </button>
          )}
          <Link to={`/s/${c.session_id}/c/${c.id}`} className="ml-auto min-h-9 px-2 py-2 text-sm font-semibold text-amber-800 underline-offset-4 hover:underline dark:text-amber-400">
            Open sheet
          </Link>
        </div>
      </div>
      {editingBlock && <BlockEditor key={editingBlock.id} block={editingBlock} send={enqueue} onClose={() => setEditing(null)} />}
    </article>
  )
}
